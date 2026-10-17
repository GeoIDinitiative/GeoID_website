# Geology, clipping and the property database

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

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

### A clip must wear the source's contacts, and a LINE hugs the ground

"Clipped geology should behave exactly like the world geology layer. Currently
clipped omits the polygon lines visible on surface." Two faults in one
screenshot of a 64 km clip.

**The clip drew no unit boundaries at all.** `clip-stream` asked for
`controllerOf.getContacts?.()` — and the controller never published it, so the
optional call was silently `undefined` and every clipped layer fell back to
`null`, which is the invisible "match" seal. The world geology drew its
contacts and the clip of it drew none. An `?.()` on a method that does not
exist fails EXACTLY like a method that returned nothing, which is why it
read as "contacts are off" rather than as a missing seam.

Published as `getContacts`, resolved once in the clip and used for the tiles
and the fill-in mesh alike. Measured after, on a 64 km clip: **4,664 seal
vertices at 0.55 opacity, 18 distinct contact colours, ZERO of them shared
with the fill colours** — every contact a darkened version of its own unit,
which is what the world layer does.

**And a LINE was drawn 11.9 km above the terrain.** `drape` is 0.006 scene
units against a globe of 3.2 units to 6,371 km. Straight down that costs
nothing; obliquely the line stands visibly off the coast it traces.

The lift was there for a real reason — *a line has no facing, so nothing culls
the far hemisphere for it*, and this file already records a hugging line
putting Australia's outline across the Atlantic. But the answer to that is
culling BY FACING, which the seal has used all along: with the far side
discarded by `followRelief(..., { cullFarSide: true })` the depth test is
unnecessary and the line can sit on the ground. Third lift removed this
session, after the drawn outline (21–47 km UNDER the terrain) and the hover
highlight (6.97 km above it).

**The pattern across all three.** Every one was a constant that looks like
nothing in the source — `0.004`, `0.006`, `0.0035` — and is kilometres on a
globe whose radius is 3.2 units. **In this scene, one scene unit is 1,991 km.**
Any lift written as a bare decimal should be read in those terms before it is
believed.

### MEASURE THE PIXELS. Geometry coverage is not what the user sees

Five fixes in a row measured 100% coverage and changed nothing on screen. The
cause was the instrument: **every one of those numbers came from geometry** —
`coverageWithin` over a feature LIST — and the complaint was about pixels.

Reading the framebuffer settles it in one number. `renderer.render()` then
`gl.readPixels`, with the layer toggled visible/hidden and the two frames
diffed, so "is there geology at this pixel" is answered by the image CHANGING
rather than by guessing at colours. On the reported 34 km study area:

| | pixels |
| --- | --- |
| as reported | **41.2%** |
| after drawing the filled-in surveys | 50.4% |
| after capping the refine on own coverage | **100%** |

The geometry said 100% throughout.

**Two mechanisms, and I had built both.**

1. **The merge is a LIST; the controller draws TILES.** `featuresIn` fills each
   survey from its own deepest level and concatenates the result — but those
   features belong to another level's tiles, which are never shown. So the
   merged surveys were in the layer's list, its legend and every extraction,
   and were never rendered. What the tiles cannot draw is now drawn as one
   static mesh beneath them.

2. **My merge defeated my own coverage gate.** The gate compares the
   POST-MERGE coverage, which the merge has just filled to ~100% at every
   level — so it can never fire. The climb chose zoom 11 and the refine
   followed it there, where the offshore survey does not exist at all
   (measured: that strip is covered at zooms 4–8 and **0% at 9 and deeper**).
   The LIST may span levels; the DRAWN map may not. The refine is capped at
   the deepest level whose OWN coverage still matches the best on offer.

**And the refine ran AFTER every check I made.** The clip arrived pinned at a
good level and walked itself to a bad one on the first settle, so a probe taken
straight after the run measured a picture that no longer existed by the time
anyone looked. Any verification of a self-refining layer has to wait past its
settle.

**The rule.** When a report is about what is on screen, the test reads the
screen. A number derived from the data structures answers a different question,
and it will keep answering it correctly while the user keeps seeing something
else.

### A SMALL box never met the other surveys, and my test boxes hid it

Four fixes in a row — the coverage gate, the per-survey merge, the pinned
floor, `ownCoverage` — each measured clean and each left the user with the same
half-empty clip. The reason is embarrassing and worth writing down in full.

**The sweep started at the level the box's SIZE deserves and only went
deeper.** `start = zoomForBounds(bounds) - 2`. That is right for choosing
detail and wrong for finding datasets: this source composites several surveys
and switches between them by scale, so a survey living at zoom 5-6 is invisible
to a box whose sweep starts at 10. The merge can only ever fill from levels the
sweep actually looked at.

- a degree-wide box → `zoomForBounds` ~7 → starts at 5 → **meets every survey**
- a 34 km study area → `zoomForBounds` ~12 → starts at 10 → **never sees them**

**Every box I tested was degree-wide.** The user's were 34-38 km. So each fix
measured 100% coverage on my box and changed nothing on theirs, four times
over, and I reported success each time. When a fix verifies clean and the
report says "no change", the fixture is the first thing to doubt — not the
cache, not the code path, and certainly not the user.

The sweep now begins `SHALLOW_LOOKBACK` (5) levels below the start. Those
levels are one or two tiles each, so it costs almost nothing, and it is the
only way `deepestFor` can know a survey exists at all. The barren counter is
held until the sweep reaches the deserved level, because a shallow level giving
less detail than the one below it is the ordinary shape of a pyramid rather
than the source running out.

Measured on a 34 x 34 km box on the north coast, the exact case that kept
failing: pinned zoom **7** (was 10), **30 features, surveys 23 AND 147, 100%
coverage drawn**, and the drawn set equal to the layer's own list.

### The clip HAD the geology and did not DRAW it

"It's not pulling all geology within the bounds of the polygon." Mapped on a
38 km box on the north coast, and the two halves of the layer disagreed:

- `featuresIn` returned **100% coverage** at zoom 12 from surveys 23 AND 147,
  and the layer's own feature list held all 40 of them;
- what was **DRAWN** held survey 23 alone — 27 features, **42.9% coverage** —
  which is the northern third of the box empty.

**The merge is multi-level and the picture was single-level.** `featuresIn`
fills each survey from its own deepest level; the clip's picture comes from
`pin()` plus `update()`, and each of those takes ONE level. A level that has
dropped a survey draws nothing where that survey was, however complete the
feature list beside it is.

The controller can already draw two levels at once — that is what pinning is,
with the view's tiles half a renderOrder above — so the fix is which level to
pin. `zoomForBounds` answers "how deep does a box this size deserve", which for
38 km is deep, and deep is exactly where a survey goes missing. The floor is
now the level with the best coverage instead.

**And the first version of that fix picked on the wrong number**, which is
worth recording because it read as correct: `levels[].coverage` is measured
AFTER the merge, so every level reports near-100% and choosing on it is
choosing at random. It picked zoom 8 — a level covering **42.9%** of that
study area on its own — while appearing to have everything. Levels now carry
`ownCoverage` beside the merged figure, and the floor is chosen on that.

Measured after: **40 drawn features, both surveys, 100% coverage**, and the
drawn set equal to the layer's list.

**A quantity that is measured after a correction cannot be used to decide the
correction.** That is the same shape as `detailWithin` counting whole features
instead of the part inside the box, twice in one week: when a chooser keeps
picking oddly, check what its number actually measures before checking the
choice.

### Fill each survey from ITS OWN deepest level, not from one fallback

"When we clip the geology it doesn't take all available datasets — it fails to
pull the bathymetry and the Irish geology."

The level merge filled from a SINGLE fallback level: the fullest-covering one
seen during the climb. That drops any survey the fallback lacks as well.
Measured over a box across the North Channel, surveys present per level:

| zoom | 23 | 147 | 7 |
| --- | --- | --- | --- |
| 5 | — | 924 | **37** |
| 6 | 3,634 | 421 | **23** |
| 7 | 1,862 | 182 | — |
| 8 | 1,254 | 174 | — |
| 9–11 | present | — | — |

**Source 7 exists only at zooms 5 and 6.** The climb reached 11, the fallback
was a 100%-coverage level at 9, and neither carries 7 — so the fill never saw
it and the dataset left the clip entirely. Source 147 goes the same way past
zoom 8. Two datasets, both dropped, which is exactly the two the report names.

Every survey is now remembered at the DEEPEST LEVEL THAT CARRIES IT
(`deepestFor`), and the merge adds each one the deep level does not have. A
later level overwrites an earlier one for the same key, so a survey ends up
held at its own best level rather than at whichever level happened to cover the
most ground.

Measured after, same box: zoom 11, 88 tiles, 954 features, **coverage 100%**,
and all three surveys present — **23: 757, 147: 174, 7: 23** — with 7 filled
from zoom 6 and 147 from zoom 8. The `filled` count grows down the climb
(0 at z6, 23 at z7–8, 197 at z9–11) as each survey drops out and is carried
forward.

**The mosaic property survives the per-survey fill**, which is the thing that
had to be checked rather than assumed: of 2,304 sample points, **one** was
covered by more than one survey. Filling from three different levels does not
double-count the ground, because the surveys still tile it rather than overlap.

**The general shape.** "Take the best level" and "take everything that exists"
are different requests whenever a source COMPOSITES several datasets and
switches between them by scale — and the second one cannot be answered by any
single level, because no single level has it all.

### Merging the levels: the finer survey where it exists, by SOURCE

Refusing a partial deep level keeps the map whole and throws away real detail
where the finer survey does reach; taking it whole loses 44% of the ground.
Neither is "all the geology that exists within these bounds", which is the
actual requirement.

**The fill is by SOURCE DATASET, not by geometry, and that is exact here
because the surveys MOSAIC.** Measured over the cross-border box: of 4,900
sample points, **ONE** was covered by more than one source. So the ground a
deep level is missing is precisely the ground of the surveys it does not carry
— measured, **2,155 of the 2,158 points (99.86%)** the deep level missed. The
deep level keeps everything it has and only the ABSENT surveys are added, which
costs no boolean geometry and cannot double-cover.

Measured live on the same box, and it beats both earlier states on every count:

| | deep level alone | coverage gate only | with the merge |
| --- | --- | --- | --- |
| zoom | 10 | 8 | **11** |
| coverage | 56% | 100% | 99.8% |
| distinct units | 24 | 70 | **94** |
| source datasets | 1 | 2 | **3** |
| vertices in box | 8,026 | 5,872 | **10,184** |

Per source at zoom 11: **23** = 612 features (the fine survey, at its own
level), **147** = 211 and **7** = 23, both filled from zoom 8. It stops at
zoom 12 on the tile budget — 323 tiles — and says so.

**The 0.2% that stays uncovered is deliberate.** It is a survey the deep level
DOES carry, generalising differently along the coast. Filling it would mean
laying a coarser copy over ground the finer map has already spoken for, and an
extraction would then count it twice. A hairline of honest gap beats a
double-counted one.

**A source with no `source_id` is treated as ONE unnamed survey**, so the merge
is a no-op rather than a wrong answer on a dataset that does not composite —
the fill can only ever add surveys the deep level lacks, and with one key there
are none.

**Where this applies.** `featuresIn` is the seam every tool, extraction and clip
uses to ask about GROUND, so the merge reaches all of them. The streaming
clip's DRAWN map keeps its full coverage a different way — the study area is
pinned underneath and the view's tiles draw above it — so the two are
consistent without the render path needing the merge as well.

### A DEEPER tile level can be a different, PARTIAL survey

"It must be an issue with different countries' datasets and offshore. When we
clip we want all the geology data that exists from the Macrostrat server within
the drawn bounds." The hypothesis was right and the effect is larger than it
sounds.

Macrostrat's `carto` layer is not one map drawn at many scales: it COMPOSITES
several source surveys and switches between them by zoom. Measured over a box
straddling the Northern Ireland border (60x60 sample grid, real tiles):

| zoom | tiles | coverage | units | source datasets | vertices in box |
| --- | --- | --- | --- | --- | --- |
| 5 | 1 | 99.6% | 14 | 1 | 428 |
| 6 | 1 | 99.6% | 32 | **2** | 3,091 |
| 8 | 4 | **99.9%** | **33** | **2** | 5,872 |
| 9 | 9 | **56.1%** | 24 | **1** | 6,551 |
| 10 | 30 | **56.1%** | 24 | **1** | 8,026 |

Past zoom 8 the Republic's survey is simply not in the tiles. **1,579 of 3,600
sample points lose their geology — 44% of the ground — while the VERTEX COUNT
RISES**, because the one surviving survey is drawn more finely.

**So the climb's ruler said "better" about a level that had thrown half the map
away.** Detail and coverage are different questions and it only asked one. This
is the second time in two days that this ruler has been the fault and the
lesson is the same one sharpened: *when a chooser keeps picking the option you
would not, check what it is maximising* — and check that what it maximises is
the whole of what you want.

A level that has LOST ground is now refused whatever its detail
(`coverageWithin`, sampled on a 24x24 grid with a bounds reject first, gated at
`COVERAGE_TOLERANCE = 0.03` — generalisation wobble along a coast, nowhere near
a survey going missing). Measured after, on the same box: the climb probes 6
(99.5%), 7 (99.8%), 8 (100%), refuses 9 at 56.3% and stops for `"coverage"` —
**zoom 8, 100% covered, 70 units, 2 source datasets, 923 features**, where
before it went to zoom 10 with 24 units from one.

**Deeper is not more.** Where a source composites surveys, "the deepest level
available" and "everything that exists here" are different requests, and only
the second is what a clip means.

### Renaming a panel means renaming it in every place it is NAMED

"Why is it still being read as preprocessing and extraction and analysis?"
Because renaming the SECTION renamed one of the three places these shelves are
named, and not the one most people read.

- `tool-shelves.js` renames the `<details>` summary — the heading you see with
  the tools column open.
- **`side-panels.js` names the RAIL BUTTON and the WORKBENCH HEADER**, and
  carried its own strings: `label: "Process"`, `hint: "Pre-processing
  toolbox"`, `hint: "Extraction and analysis"`. These groups are moved onto the
  tool rail as workbenches, so for anyone working from the rail the old names
  were the names on screen, and they are on screen most of the time.
- **The Research Hub's own pages** told the reader where to go: Raster Tools
  and Vector Tools both said "the GIS page's Pre-processing Toolbox".

One `SHELF_NAMES` constant now, read by the workbench title and its tooltip,
and pinned against the section headings by a test — with COMMENTS STRIPPED
FIRST, since the note explaining this fault quotes the old strings and prose
is not a name (the same reason tool-runner's param scanner strips them).

**The rail CAPTION is deliberately not the shelf name.** The rail is a column
of icons with a caption under each, and "Pre-proc" once wrapped to two lines
and made its button taller than the measure tools beside it — the reason that
caption was shortened in the first place. It reads "GIS tools"; the full name
is the header and the tooltip, where there is room for it.

Verified on the live page, every surface at once: rail captions "GIS tools" /
"Analysis" with tooltips "Geoprocessing — tools that make a map layer" and
"Analysis — tables, statistics and plots"; workbench headers **Geoprocessing**
and **Analysis**; section headings the same.

**The general rule, which this file keeps paying for at every level:** a name
lives in as many places as there are surfaces that show it. When something is
"still called the old thing", grep the old string before assuming a cache.

### The highlight floated 7 km up, and a lift is an altitude

"The polygon outlines float way above the surface — looking like a massive
offset." The thin cyan line in that screenshot is the HOVER HIGHLIGHT
(`0x8ef6ff`), not the drawn outline, and it was doing exactly what it looked
like.

`buildHighlight` raised the selection `0.004` scene units and the hover
`0.0035`. The globe is 3.2 units to 6,371 km, so those are **7.96 km** and
**6.97 km** above the terrain. Straight down that costs nothing, which is how
it survived; at a few kilometres across with any obliquity at all the outline
stands visibly off the unit it is tracing.

**This is the measure marker's fault in a second place**, and that note already
states the rule: *a lift is an altitude, and an altitude parallaxes.* Worth
having written twice, because both times the number looked harmless in the
source — 0.004 of anything reads as a hair.

**The lift was never needed.** These nodes draw with `depthTest: false` in the
highlight band (239), above every data layer, so nothing can bury them at any
height — the lift was solving a depth fight that sorting had already settled.
Set to zero. Measured against the feature's OWN coordinates: **6,968 m before,
0 m now.**

**And `FILL_DRAPE` is already 0**, which is why the fills and the seal were
never the problem. The remaining fixed lifts are the LINE path (`drape` 0.006,
about 11.9 km) and a tool output's (`0.008`, about 15.9 km) — those govern
LineStrings and points, not polygon edges, and a river or a fault is a line in
its own right that has always been drawn lifted and depth-tested.

**A measurement trap paid for in the same session.** The first live check
recovered lat/lon by inverting a vertex position and compared that against
`surfacePoint` — and reported a 63 km offset. The inversion ignored the spin
frame, so it was comparing two DIFFERENT places on terrain that varies by
~120 km at the default exaggeration; 63 km was the relief, not the lift.
Compare against the feature's own coordinates, never against a lat/lon
recovered from the geometry.

### The drawn outline was UNDER the terrain, and Export was dead markup

Two of three complaints about the clip procedure measured out to faults with
nothing to do with clipping.

**The drawn outline sat below the ground.** Measured on a drawn study area
over Northern Ireland: the terrain there stands at **123.66 km** above the base
globe at the default exaggeration, and the outline's vertices sat at **76–102
km** — twenty to forty-seven kilometres UNDER it — and were **depth tested**,
so the hills ate the line. That is exactly what "not tight to the surface"
looks like.

The seal had already solved this for geology contacts and the outline path
never got the treatment. The note explaining why was wrong in an interesting
way: it said outlined rings could not use the seal "because with no fill
beneath them there is nothing for the seal's coplanar trick to seal against" —
which reads the seal backwards. What makes it hug is `depthTest: false` plus
culling the far side BY FACING, and neither needs a fill underneath.
Coplanarity was never the mechanism.

Routed into the seal buffer, measured again over 91 ring vertices against the
ground under each: **median 0.1 m, worst 0.3 m.** A LineString still takes the
lifted, depth-tested path — a river or a fault is a line in its own right, not
the edge of something.

**And the Export panel had never been wired.** `#export-layer`,
`#export-format`, `#export-crs` and `#export-run` live in `panels.js` and NO
module addresses them: measured live, the layer select held zero options, the
button did nothing, and there was no status node for it to report into. Its
format list — geojson, csv, xyz, wkt, stl, msh, obj — has no `shp` in it
either, so even wired it could not have written one.

**The shapefile writer itself is sound**, which is worth recording because it
was the natural suspect: `buildShapefileZip` over 60 real Macrostrat polygons,
read back with GDAL — 60 features, Polygon, correct extent, WGS84 written, **0
invalid, 0 empty, 0 warnings**, and no DBF field-name collisions from the
ten-character limit. The bug was never in the writing; it was that the panel
somebody presses could not reach it.

Wired to `layer-export-dialog`, which is the one export surface and offers
shapefile first for a polygon layer. Third time this week the answer to "X
does not work" has been *the control you are pressing is not the code that
does X*.

### Two shelves: Geoprocessing and Analysis, and the OUTPUT decides

`Analyse · Prepare` and `Analyse · Tools & Results` had grown by accretion —
raster ops beside zonal statistics, a field calculator beside a signal
spectrum, four export buttons beside an Export group that already existed. The
names said nothing, so the answer to "where is that tool" was "open both".

**The rule is the one already applied to the 47-tool registry: a tool that
produces a MAP LAYER is geoprocessing; one that produces a TABLE, A STATISTIC
OR A CHART is analysis.**

| Geoprocessing | Analysis |
| --- | --- |
| Georeference an image | Signal Analysis |
| Surface Analysis (raster ops) | Zonal Statistics |
| Vector operations | Explore & Edit (Charts / Time / Editor) |
| Attribute Query + Query syntax | Charts, Time |
| Attribute Table | Seismograms (FDSN) |
| Point & Pixel Extraction | |
| All tools (the 49-tool registry) | |
| Batch runner, History | |

**Six blocks retire**, each with the better door named beside it in the code:

| retired | because |
| --- | --- |
| the four export buttons | the Export group |
| the symbology accordion | the symbology dialog |
| Add WFS layer | Workspace's + Data |
| Extract From Layers | its clipping half goes through the `clip` tool and arrives as real mapped layers; its picking half is Point & Pixel Extraction |
| Sample Raster At Point | one raster at one typed coordinate, which Point & Pixel Extraction does by clicking, for every ticked raster |
| the Model Builder block | Model Builder is a tab on the nav bar |

**Point & Pixel Extraction is GEOPROCESSING, not analysis**, and it is the one
placement the output rule alone gets wrong. It ends in a table — but so does a
query. What decides it is that the question is asked IN MAP SPACE: the points
are placed on the globe and the values come off layers by position.

**And "Analysis tools" was the whole 49-tool REGISTRY.** It sat on the analysis
shelf holding Vector geoprocessing (12), Surface analysis (21), Hydrology (5)
and Interpolation (4) — and this file's own audit found **42 of the 49 produce
a map layer**. The name described the panel it happened to be in rather than
what it held; it is "All tools" on the Geoprocessing shelf now.

**Extraction appears on BOTH shelves on purpose**, and they are different
questions: clipping layers to a polygon is geospatial and lands on the globe;
sampling values at points is data and lands in a table.

Three blocks retire to homes that already existed — the export buttons to the
Export group, the symbology accordion to the symbology dialog, Add WFS to
Workspace's + Data. **Hidden, never removed**: other modules read those ids
unguarded at boot, which is the lesson `geology-structures-toggle` already
records.

**Moved after render, not rearranged in `panels.js`.** That MARKUP is one
string rendering all ten worlds and every id in it is addressed by some other
module; moving the node keeps every id, handler and world intact. Blocks are
found by a CONTROL THEY CONTAIN — they have no ids of their own — and the move
stamps one on so later passes are cheap.

Four faults in getting there, every one of which looked like something else:

- **`id` meant two things.** On a RETIRED spec it names an element that exists;
  on a BLOCK it names the id to STAMP. `blockFor` checked id first and returned
  early, so on the first pass nothing resolved and NO BLOCK EVER MOVED — while
  the headings and retirements either side of that loop worked perfectly and
  made the module look correct. The panels were renamed while every tool sat
  where it always had.
- **Three anchors, one block.** `attr-query-run`, `calc-run` and
  `attr-stats-run` all live inside one "Attribute Table" section — one tool,
  not three that happen to be adjacent — so each spec moved the SAME node and
  the last one won. Claimed once per pass now, and a second claim is refused.
- **A block titled like its shelf.** The vector block was itself called
  "Geoprocessing", which says nothing inside a shelf of that name.
- **A section title is a bare TEXT NODE**, not a span: these summaries read
  `<span class="section-icon">…</span>Geoprocessing`. Two span-based retitles
  failed differently and both read as one bug — the first APPENDED
  ("Vector operationsGeoprocessing"), the second found no span with text and
  silently did nothing. When a retitle will not take, print the summary's
  innerHTML before guessing at another selector.

**And the probe that misled me was one I had mangled myself.** The first
collision check ran on a page where I had already hand-moved a block while
debugging, so it reported a structure the fresh page did not have. Re-measure
on a reload before trusting a DOM audit.

### The clipped layer was never a LAYER, and three complaints followed

"Still 2 functions in extraction and preprocessing. We shouldn't need to define
the resolution (as they are polygons), can't export as shp, and it fails to map
the clipped map — unify the functions into the geoprocessing tool."

Four reports, and after measuring, **one cause**: the extraction panel did its
OWN vector clipping and kept the result in the export package and nowhere else.
It was never a layer, so:

- it **could not be mapped** — nothing was ever added to the globe;
- it **could not be exported as a shapefile** — `layer-export.js` writes
  LAYERS, and `shapefile-writer.js` was already there, already tested, already
  wired for every ordinary layer;
- and the panel asked for a **sample resolution over work that has none** — a
  polygon clip is exact, and the spacing governs only the sample grid.

The duplication was the same shape as the other two this week: not a duplicated
algorithm, but the same operation reached from a second surface that had since
missed everything the first one learned. `Analyse · Prepare` runs the vector
ops (`vec-op` = "Clip by layer"); `Extract From Layers` clipped again on its
own.

**Routing the panel's clip through `runToolAuto("clip", …)` fixes all four at
once**, because being a real layer is what every one of them wanted: it draws,
it takes its place in the stack, it inherits the source's own colours and
legend, `formatsFor` offers **shp** (measured: `shp, geojson *suggested, kml,
wkt, csv`), and a STREAMING input is asked about this ground before it is cut.
The package still gets its rows for the CSV, read back off the layer the tool
made, and a clip that fails falls back to the pure function rather than
stopping the whole run.

Measured end to end, Within set to a drawn study area: *"Within Study area 1 —
4,340 samples over 4,286.9 km2 · 1 vector layer: 277 of 921 features within"*,
and the new layer **"World geology (Macrostrat) within Study area 1"** on the
globe with legend "12 of 15".

**And hiding the resolution exposed a second fault of my own making.** With the
grid-spacing row hidden for a pure clip, the run STILL produced 4,340 samples —
so a control I had just hidden was still governing the run. A hidden control
that still does something is worse than a visible one that does not apply. The
grid is skipped entirely when no sampled layer and no built-in column is
ticked, which is what makes hiding the spacing honest.

**`node --check` is not a parse check.** The ternary this went in as was
malformed (`}); : { … }`) and `node --check` passed it; `module-css.test.mjs`,
which actually imports every module, failed it. Second time this session. Run
the suite, not the syntax check.

### The THIRD area picker, and why a captured shape could not be reused

"We still have duplicate extract-by-layer functions — we need this fundamental
fix where preexisting drawn polygons can be used."

The extraction ENGINE was never duplicated — one `runExtraction`, one
`extractPolygonSamples`. What was duplicated is the question in front of it:
**which patch of ground**. `extent-picker.js` exists because that question had
already been answered three ways (the weather card, Earth Engine's third of an
answer, and the GFS card) and was lifted out so it would be answered once.
`analysis-panel.js` never adopted it and kept its own `renderWithin` and
`resolveBounds`.

**And the copy was missing the one thing the original exists for: the FALLBACK
CHAIN.** `extent-picker` resolves "drawn" as live overlay → the last captured
polygon still ON the globe → arm the tool. Extraction's copy read the live
overlay and stopped. Pressing **Done captures the shape and clears that
overlay**, so the moment a drawing became a real layer the panel answered "Mark
out an area first" about a polygon sitting in front of the user. A shape you
already drew is the commonest case there is, and it was the one case with no
way to express it.

**Two shapes of answer, one chain.** A fetcher wants a BOUNDING BOX because
that is what a tile service takes; a clip wants the POLYGON, and handing a clip
a box would quietly widen every study area to its own extent — which is why
extraction could not simply call `resolvePolygonExtent`. So the picker grew
`resolvePolygonRings`: same modes, same option list, same fallback, answered as
rings with the layer's own collection as the mask (rebuilding it from the rings
would be a second copy of the same polygons).

Verified live on the sequence that failed — draw, press Done, leave Within on
"Drawn / boxed area", Run — with the live overlay confirmed **cleared**:
*"Within Study area 1 — 250,000 samples over 6,516,679 km2."* It names the
layer it fell back to, so the reuse is visible rather than silent.

**The general shape, which is now three for three in this file**: a duplicate
is rarely a duplicated ALGORITHM. It is the same question asked in two places,
where one of them has since learned something the other has not — the clip
button that never got the streaming fixes, the panel ops that never got the
runner's, and this. When something "cannot be done", check first whether some
other surface can already do it.

### The duplicate audit: 26 of 26, and the runner is the superset

Asked to audit the rest and keep the most developed of each. Measured by
parsing both registries rather than reading them:

- **26 panel ops** (11 vector, 15 raster) against **48 runner tools**.
- **26 of 26 are shared** — every id in the panel exists in the runner.
- **ZERO are panel-only.** The runner is a strict superset, with 22 further
  tools (kriging, IDW, TIN, voronoi, watershed, viewshed, terrain, zonal
  statistics, the validation set…), sidecar engines on five, more params, and
  the structural tests that pin every param to a reader.

**Where the panel LOOKED richer, it was not.** `spatialJoin`'s "N matched",
`reproject`'s same-CRS refusal and `contours` deriving its levels from the
raster's own statistics are all present in the runner too — its versions were
built from the panel's and then improved. So "keep the most developed" resolves
to the runner in every single case, which is not what an audit usually finds
and is worth stating plainly.

**25 of the 26 now delegate.** The panel keeps its own front end; only the work
moves. Two do not, each with the reason written beside it rather than left as a
silent omission:

- `union` adds a sentence when a ring-level merge fills an interior ring.
- `overlay` builds its weight entries from SEVERAL layers by name out of one
  text field; the tool takes a weights string against its declared inputs, and
  the two are not the same control.

**`buffer` carried the one conversion that mattered**: METRES in the panel,
KILOMETRES in the tool, so it is delegated as `param / 1000`. Handing it over
unconverted would have turned a 1 km buffer into 1,000 km — a duplicate is
dangerous to remove carelessly as well as to keep. `reproject` keeps its
empty-select guard, which the runner cannot make because it cannot see two
dropdowns nobody has touched.

**The raster panel offers two KINDS of second input** — another raster
(`ras-op-b`) and a vector layer of zones (`ras-op-zones`) — in two controls,
where the runner declares which kind each tool wants. `runRasterThroughRunner`
reads that declaration instead of keeping a third list of which op wants which.

**`runZonalStats` is NOT a duplicate**, and the distinction is worth keeping:
it produces an exportable TABLE where the tool produces a painted LAYER. Two
products over one engine call, which is the opposite of two implementations of
one product. `fieldStatistics` and `fieldCalculator` are panel-only.

Verified live on `buffer`, the one with the conversion: the old panel call
(`GP.buffer(fc, 50000)`), the new tool call (`GP.buffer(fc, 50 * 1000)`) and
what the panel actually DREW all agree to six decimal places.

**One thing the check turned up that is NOT about duplication**: a 50 km buffer
of a 1-degree square pads its extent by **35.4 km, exactly 1/sqrt(2) of what was
asked**. Identical before and after, so it is `GP.buffer`'s own polygon
behaviour and not a regression — but a polygon offset should run parallel to
each edge, which puts the extent pad at the full distance. It reads as corner
vertices being offset along their 45-degree bisector with no mid-edge point to
carry the extent. Recorded here rather than fixed in an audit.

### There were TWO "Clip by layer" buttons, and I was fixing the other one

"Have I been using a duplicate clip function in the geoprocessing tab?" Yes —
and it is the answer to a whole run of reports that each fix changed nothing.

`toolbox-ops.js` and `tool-runner.js` grew the SAME operations under the SAME
ids: `clip`, `difference`, `intersect`, `union`, `buffer`, `dissolve`, `hull`,
`centroids`, `simplify`, `reproject`, `spatialJoin` — eleven shared — plus most
of the raster set. `clip` is even labelled **"Clip by layer" in both**. One is
behind the Geoprocessing panel's `#vec-op` select, the other behind the tools
window, and nothing on screen says which is which.

They drifted exactly as this file predicts a duplicate will. Every fix to the
tool-runner clip over a long stretch — asking a streaming layer about GROUND
instead of reading its snapshot, inheriting the source's own colours and
legend, the Detail level, the self-refining output — went to the tools window,
while the panel went on calling `GP.clip(a.collection, b.collection)` directly.
The output name is `clip_{name}` on both paths, so the layer and its legend card
looked identical and the reports read as "no change" four times over.

**The lesson is about the DIAGNOSIS, not the code.** When a verified fix makes
no difference to the user, the first hypothesis should be that the button they
press is not the code you changed — before stale caches, before browser state,
before re-reading the fix. I asked them to reload twice. What settled it was
one question from the user and one `grep` for every caller of the engine:
three call sites, one of which nobody had mentioned.

`clip`, `difference` and `intersect` now delegate to `runToolAuto`; the panel
keeps its own front end and only the work moves, and `runVectorOp` resolves an
op that answers with a promise (the delegated ones are async, because a
streaming input is asked about this run's ground before any engine sees it).

**The rest are named with a reason rather than left silent.** `buffer` above
all: the panel asks **metres** and the tool asks **KILOMETRES**, so delegating
it unconverted turns a 1 km buffer into 1,000 km — a duplicate is dangerous to
remove carelessly as well as to keep. `union` adds a sentence of its own when a
merge fills an interior ring. Those still read `.collection`, so they still see
a streaming layer's snapshot, and that is the next thing to close.

`toolbox-duplicate.test.mjs` pins the shape: every id shared between the two
registries is either DELEGATED — and really routes, and no longer calls the
engine directly — or named in the "not yet delegated" note with its reason. A
new shared id has to be a decision.

Verified through the panel itself, on the user's own sequence (draw the polygon
first, then load the geology, then Clip by layer): status
"clip_World geology (Macrostrat): 50 features at source zoom 5. Refines as you
zoom, like the map it came from", `streamingClip: true`, legend **12 of 15
units** rendering 12 class rows, 14 distinct drawn colours and **zero** in the
no-value grey.

### A GRADIENT BAR in the legend means NO legendInfo, not a bad palette

"The rock types still aren't registering on the legend" — and the card showed a
smooth gradient where the source's card showed named swatches. That bar is not
a palette anybody chose: it is the dock's STAND-IN for a layer carrying no
`legendInfo` at all. Read it that way and it names its own cause.

Which also means it identifies the layer for you. Measured on the live DOM,
the four cards in that corner were: the clip with **12 class rows**, "Study
area 1" with **0 rows and a ramp**, the world layer with 12 rows, and the
basemap. A drawn polygon has no symbology and correctly gets the bar — so
before diagnosing a ramp, check WHICH card it belongs to, because in a stack of
four the header above it may not be the one you are reading.

**The hole it exposed was real, though.** The streaming clip inherited colours
only from `sourceColourField`, the marker `paintFromSource` writes. A source
last painted some OTHER way — a field chosen in the symbology dialog, a
catalogue palette, a rebuild where `styleChoice` remembered a hand-picked
column — carries no marker, and the clip then inherited nothing and fell
through to the bar. The column is PROBED when the marker is absent: every
feature carrying a `color` IS the source's own key whether or not anything
wrote the marker down. Failing open into "no legend" is the wrong direction for
a card whose only job is to say what the colours mean.

Verified by deleting the marker and clipping again — the exact state that
produced the bar: colour column recovered as `color`, legend **12 of 15**, 15
distinct drawn colours, **0** vertices in the no-value grey, and the card
rendering 12 class rows instead of a ramp.

### A SECOND construction path needs the symbology too

"It's not assigning the correct legend entries — assigning many polygons as
other — see the legend for the source world geology and the clipped layer, they
are not the same." The two cards side by side were the whole diagnosis: the
world layer keyed by name with its published swatches, and the clip of it
showing a bare GRADIENT BAR.

A gradient bar means no `legendInfo` at all. The streaming clip was built with
`colourFor` at construction — which paints the tiles — and nothing else: no
repaint pinning that paint against a later recolour, and no legend. The static
clip path in `tool-runner` had done this properly for weeks through
`inheritSourceColours`; the streaming path was written beside it and inherited
none of it.

That is the shape to watch for: **when a feature grows a second construction
path, everything the first path does AFTER building the geometry has to be
carried across, and none of it will fail loudly.** The colours were half right
— the tiles were painted at build — so the map looked plausible while the key
beside it was empty.

Fixed by calling the same `legendFrom` with the same colour column, so the two
cards are one key by construction rather than by two functions agreeing.

**The parity check that means something is over the SAME GROUND at the SAME
LEVEL.** Compared straight after the clip, the two legends share **zero** units
— and that is correct, not a fault: the world layer was at zoom 2 calling the
ground "Cenozoic sedimentary rocks" where the clip at zoom 10 calls it "Gala
Group". Macrostrat renames its units per level, so two layers at different
zooms can never agree and comparing them says nothing.

With the world layer refined to the same view (zoom 6 against the clip's 10):
**15 of 15 clip units present in the source, 0 colours disagreeing**, and 0
units the clip invented — `#fd9a52`, `#fdc07a`, `#a6d84a`, `#9ad9dd`, `#9400a7`,
`#2b9841` identical on both. Drawn vertices in the no-value grey `#8a8a8a`:
zero.

### A clipped layer streams, or it is a photograph of a map

"Ensure the clipped geology behaves exactly like the current global Macrostrat
streaming — currently it fails to refine itself as we zoom in." It was a
SNAPSHOT: the features in hand when the tool ran, triangulated once and never
touched again, while the source beside it refined on every settle.

**The fix is one controller, not a second refresh path.** `clip-stream.js`
gives the clip its OWN `createTiledVectorLayer` pointed at the SAME tile
service, carrying the study area as `clipTo`. The tile cache, the zoom choice,
the contacts, the seam clipping and the refine are then one implementation used
twice — the discipline the imitated label engine and the polygon-area formula
both cost. What is deliberately not shared is the world layer's own watcher: it
refreshes by dataset id through `loadTiled`, which would rebuild a clip as a
world map.

Four faults found by flying the camera rather than by reading, each invisible
to the one before:

- **The refine box is the view CUT TO THE STUDY AREA.** The view alone streams
  tiles the mask is about to throw away; the mask alone means flying into one
  corner asks for the whole area at the corner's zoom. Pinned in
  `clip-stream.test.mjs`, including that a view which has LEFT the area answers
  null rather than an inside-out box.
- **The study area must be PINNED, or a clip empties as you zoom.**
  `features()` and the drawn set are the finest zoom on screen, so a refine
  that only fetched the view left the rest with nothing drawn — measured, a
  1.0 x 0.6 degree clip at 60 km went from 229 features to 127 and the 127 were
  the corner in shot. The world layer's own rule, applied to a clip whose world
  is its study area.
- **The world layer's FEATURE BUDGET is wrong for a clip, by a hundredfold.**
  `chooseZoom` extrapolates 2x per level past the baked ceiling — right when a
  hemisphere can pull 49,150 features and freeze for twenty seconds. Measured
  on this clip: `update` was asked for zoom 12, walked itself down to **9**, and
  the ground it was refusing holds **277 features**. The tile cap still bounds
  the work to the same `maxTiles` the world layer triangulates on any refine,
  and a clip cannot run away because its mask will not let it. `minZoom` is the
  pinned base, or the same walk-down takes a clip pinned at 10 down to 9 —
  coarser than the sheet it was drawn on. And `refine` records the ACHIEVED
  zoom, never the asked one, or the next settle believes it has already arrived.
- **The feature LIST must not shrink to the view.** Refining took the layer's
  list from 277 to 39 with the legend reading "39 polygons" — an export at that
  moment would have written a study area with most of itself missing. The drawn
  map refines; the list stays the complete area at the pinned level, and
  anything wanting finer data for a box asks `featuresIn`.

Measured flying in, after all four: **zoom 10 at 382 km, 10 at 120, 10 at 40,
12 at 12 km**, with 28 tiles drawn at the end — 16 pinned base plus 12 view
tiles. The middle steps hold at 10 because the ground in view still deserves
10, which is the world layer's own behaviour and not a failure to refine.

**Two traps in the measuring, both of which produced a confident wrong answer.**
The camera EASES geometrically, and at the few frames per second a software
renderer manages a descent takes many seconds — sampling on a fixed timer read
"no refine" from a camera that was still moving and had never settled. Wait on
the camera's own position going still, then wait again for the fetch. And a
`void`-ed async watcher swallows its own failures: when a refine does not
happen, prove the watcher ran before theorising about what it computed.

### The gridlines were the tile BUFFER, drawn twice

"How do we remove the huge gridlines from the Macrostrat streamed tiles? The
geology polygons do not unify over this line." Both halves of that sentence are
the same fact.

An MVT tile carries a **buffer**: geometry a little past its own edge, so a
renderer drawing that tile on its own can carry a stroke across the boundary
without cutting the join. Measured on the real tiles at zoom 9, that buffer is
**176 m on each side** — so every seam has a **347 m band that BOTH tiles
describe**, and this app, which merges every tile into one scene, drew both.
1,392 of 30,150 samples across one seam were covered twice.

Opaque, a double draw of the same colour is invisible. Translucent it is not:
two draws reach 1-(1-a)^2 where the ground either side reaches a, so the band
comes out **brighter** — a grid, because a tile boundary is a grid. And since
each tile clips its own copy of a unit that crosses the seam, the same fact
shows as two features that do not join.

**The buffer is for STROKES; fills are meant to be scissored to the tile rect.**
A per-tile renderer does that with a clip rectangle. Merging into one scene, the
equivalent is to clip the geometry — Sutherland-Hodgman against the four edges,
in TILE units before projection. The clip region is convex, so each ring clips
to exactly one ring with its winding preserved, which the hole grouping depends
on.

Measured on the same four tiles, before and after:

| | before | after |
| --- | --- | --- |
| buffer, each side | 176 m | **0 m** |
| samples covered by BOTH tiles | 1,392 | **0** |
| samples covered by one | 9,172 | 10,556 |
| ground covered (3.6 m cells) | 810,000 / 810,000 | 810,000 / 810,000 |
| interior holes, rings and triangles | 0 | **0** |

The ground previously drawn twice is now drawn once, and NOTHING was lost — the
coverage test is the control that says so. One polygon of 287 disappeared
because it existed only in the buffer.

**Clipping then leaves the ring running along the tile edge, and that cut is
not a contact.** With the contact stroke on, stroking it would have traded a
bright grid for a dark one — the same grid in another colour, which is the
shape of fix worth catching before shipping it. Each tile passes its own
`edgeBounds` and the seal skips any segment with BOTH ends on the SAME edge:
both ends and the same edge, so a real boundary that merely touches the seam at
one vertex still gets its stroke. Measured on tile 9/247/162: seal vertices
**4,738 without `edgeBounds`, 4,680 with** — 29 segments of pure tile cut
removed.

**A side effect worth having**: `features()` no longer returns the same ground
twice across a seam, so an extraction cannot double-count it.

**The 8 samples that changed state are the boundary coin toss, not a gap.**
Singly-covered went up by 1,384 where 1,392 stopped being double — the eight
sit exactly ON the seam longitude, where a point-in-ring test is ambiguous by
construction. This file already records never sampling a polygon test at its own
vertices for the same reason.

### The grey was a real unit — and looking for it found a real bug

"Clipping geology layer is still flawed — the polygons might exist underneath
the grey." Two answers, and they point opposite ways.

**The grey is not the `(other)` class, and nothing is under it.** Measured on a
clip of 1,113 features over 48 units: vertices drawn in the bug grey `#8a8a8a`
came to **ZERO**. The grey is `#969696`, which is **Macrostrat's own published
colour for the Southern Highland Group** — 4,932 vertices of it — with `#777777`
for "Fault Zone Rocks, Unassigned". The compilation publishes nine greyish
colours in this region alone. The grey IS the polygon, and the colour
inheritance is working: 41 distinct drawn colours, legend "12 of 48".

Worth keeping, because it will come up again: **a survey's own grey and this
app's no-value grey are four RGB points apart and cannot be told apart by
eye.** Separate them by counting the exact hex off the geometry.

**But the suspicion was sound, and it found a different fault.**
`detailWithin` — the measure the zoom climb decides on — counted every vertex of
any feature that merely TOUCHED the box, rather than the vertices INSIDE it. At
a coarse level one unit sprawls across several degrees and contributed its whole
outline for the sake of one corner overlapping; at a fine level the same ground
arrives as tile-clipped pieces contributing only what is actually there. So
**coarse scored higher than fine**, the climb picked coarse, and two barren
levels later it stopped.

Measured on a 1.2 x 0.5 degree box: balanced, full and maximum ALL returned
**zoom 8 with 2 tiles**, where zoom 9 needs six and nothing was near a budget.
The climb was not being stopped by cost — it was being told that coarser was
better, which is the opposite of what it exists to decide.

Counting in-box vertices fixes it. That box now resolves **17 distinct units
against 15**, and reports `stoppedFor: "source"` honestly — it is mostly
offshore, where the compilation really does stop improving, which is a different
statement from "the budget ran out" and now says so.

**No regression where it already worked**, and the numbers are now monotonic
with depth the way the quantity's name implies:

| detail | zoom | tiles | vertices IN box | clipped | isolated holes |
| --- | --- | --- | --- | --- | --- |
| fast | 10 | 12 | 3,204 | 176 | 10 |
| balanced | 12 | 90 | 4,495 | 342 | 2 |
| full | 13 | 288 | 6,146 | 654 | 1 |

**The lesson is about the MEASURE, not the map.** A quantity called "detail over
this ground" that is actually "size of everything overlapping this ground"
answers a different question, and it answers it confidently. When a chooser
keeps picking the option you would not, check what it is maximising before
checking what it is spending.

### The hover highlight was drawn, and sorted underneath the map

"How come the polygon outlines fail to highlight when hovered over?" They did
not fail. They were drawn, correctly, and painted over — and the screenshot
that came with the question was of them showing through a FADED sheet, which
is the tell.

`buildHighlight` builds its outlines at renderOrder **239/240** with
`depthTest: false`, which is emphatic enough. But the nodes go into a bare
`new THREE.Group()` parked under `GeoID-ImportedGeoLayers`, itself renderOrder
0 — and `reversePainterSortStable` compares **groupOrder before renderOrder**,
with `projectObject` reading groupOrder off the nearest `isGroup` ancestor. The
holder's default zero became every child's sort key.

Measured live while hovering a geological unit: the overlay EXISTED — nine
LineLoops, right geometry, right colour, `depthTest` off — sorting at
**groupOrder 0 against the geology fills' 51**. Drawn first, and the fills do
not depth-test either, so they painted straight over it. The 239 was never
consulted by anything.

**This is the FOURTH time this tree has paid for a Group left at zero**: the
event markers in their `markers` group, `measureGroup` burying the polygon
being drawn, the satellite bands flattened by `applyStack`, and now this. The
rule earns its own line: **when something with a high renderOrder is buried,
read its ANCESTORS before its material.** A `THREE.Group` has no material, its
order is decided before any child's renderOrder is read, and its default is
zero.

`bandHolder()` puts both the hover and the selection holder at
`HIGHLIGHT_BAND = 239`, above the event markers at 230 — a highlight answers
"this is the thing you are pointing at" and nothing may bury it — and marks
them `keepRenderOrder` so `applyStack` cannot flatten them back.

**The A/B is the whole verification.** Same camera, same hover, the overlay's
materials forced white and opaque so a one-pixel cyan line at 0.55 could not be
argued about in a downscaled screenshot: with the holder at 239 the unit wears
a traced white outline over the geology; with the holder set back to **0 and
nothing else changed**, the outline is gone entirely. Measured either side, the
child's groupOrder reads 239 and 0 against fills at 51.

`draw-order.test.mjs` pins it on the source: no holder may be built as a bare
`new THREE.Group()`, both must go through `bandHolder`, and the band must
outrank the event markers. A text check is blunt, and it catches the one thing
that actually regressed.

### The contact network was already on the GPU, painted invisible

"When we decrease the opacity it reveals intricate polygons that have outlines
that glow when we hover over them — how do we seamlessly add this detail to
surface level?" The answer is that nothing had to be added. The geometry was
already there, at full streamed resolution, and it was being painted a colour
chosen to hide it.

The `seal` strokes EVERY filled polygon's own outline into a LineSegments
buffer at the fill's own height — measured live on the world geology, **848,456
vertices across 25 tile objects**. It was written to cover the hairline where
two neighbours' boundaries disagree, and to cover it invisibly, so it is drawn
in the polygon's OWN fill colour. A complete contact network, on the GPU, that
nothing could see.

**What the slider was revealing is alpha ACCUMULATION, and it is worth naming
because it looks like a feature.** Along every contact the line is stroked
twice — once by each neighbour — over the fills beneath. At alpha 1 all of it
is opaque and the seal is exactly its own fill's colour, so there is nothing to
see. Below 1 that doubled line accumulates more alpha than either interior and
reads as a crisp outline. Fade the sheet and the map gains detail; turn it back
up and the detail goes. Precisely backwards.

**And a second fault made it worse in the same direction.** `setOpacity`
OVERWROTE every material's opacity with the slider's value, so a sheet dragged
to 40% did not fade its contacts to 40% of their own weight — it PROMOTED them
from whatever they were to 40%, level with the fill. The stroke now carries
`userData.baseOpacity` and the slider MULTIPLIES. Measured after, at layer
opacity 1 / 0.6 / 0.4 / 0.2: the seal sits at 0.55 / 0.33 / 0.22 / 0.11, a
constant **0.55 of the fill at every setting**, where before it was 1.00 of it
at every setting.

**So drawing contacts is a colour decision, not new geometry.** `contacts` on
`renderFeatureCollection` takes a mode:

- `match` — the polygon's own colour. Invisible, and the historic default that
  every non-geological vector layer keeps.
- `shade` — its own colour MULTIPLIED. The default for geology, because a
  contact then stays attributable to the unit it bounds: the sheet still reads
  as its own legend rather than as a net thrown over it. Verified live, and the
  multiply is in LINEAR space where the colours live: fill `#7bc771` strokes
  `#62a15a`, `#d81e5b` strokes `#ae1648`.
- `ink` — one colour for every contact, the printed-sheet look, which says
  nothing about which side is which.

**Subtle by default, and the reason is a hard limit rather than taste.** WebGL
draws every line one device pixel wide whatever `linewidth` says, so at a global
view 9,000 polygons' boundaries are 9,000 hairlines; a strong ink fills the map
in solid. `subtle` is shade 0.62 at 0.55 opacity.

A **Boundaries** select (subtle / strong / ink / none) sits on the tiled layer's
own row, remembered in localStorage, and applies to every tiled geology layer so
the control means one thing. It goes through `setContacts`, which REBUILDS the
tiles on screen and fetches nothing — a rebuild rather than a material tweak
because the ink is baked into the seal's per-vertex colour, which is what lets
each contact carry its own unit's hue. It is offered only where
`layer.tiled?.setContacts` exists: a dropped shapefile has its own outline
controls in the symbology dialog, and two controls for one idea is how they
drift.

The best part of this is what it did NOT cost: no extra tiles, no second
geometry, and the seal goes on covering the gaps it was written for — the
contact stroke and the gap cover are the same line.

### A clip shipped whatever `maxTiles` allowed, and that is a resolution

"It loses the resolution — ensure that for any geology clip the highest
resolution layer is always the one that gets clipped. Currently we are clipping
low res polygons leading to data gaps at contacts." Measured, and the diagnosis
is one line: **`levelFeatures` truncated instead of refusing.**

`tilesForBounds(bounds, z).slice(0, maxTiles)` with `maxTiles` at **16** — the
budget that exists to stop a REFINE stuttering the flight it serves, left
standing on the path every extraction and clip takes. A probe draws nothing, so
that budget was answering a question nobody asked. Worse, the climb in
`featuresIn` reads a truncated level as the SOURCE RUNNING OUT: fewer tiles
fetched, fewer vertices counted, `detail` falls, the level is called barren and
the climb stops. This is the same fault `chooseZoom` documents for the display
path — fixed there, never carried across.

Measured live over Northern Ireland, tiles a level needs (Macrostrat's carto
tiles are **Web Mercator XYZ** — one tile at zoom 0, spanning 360 degrees.
This line said EPSG:4326 2x1 for months and it is WRONG: `tilesForBounds` in
`mvt.js` is the ordinary slippy-map formula and is the truth. The 2x1 note
belongs to GIBS, which really is 4326. Believing it cost a whole glacier
pyramid baked on the wrong scheme — every tile valid, every polygon valid,
Iceland decoding into the Laptev Sea):

| box | z8 | z9 | z10 | z11 | z12 | shipped at |
| --- | --- | --- | --- | --- | --- | --- |
| 2.8 x 1.3 deg | 9 | 20 | 63 | 238 | 891 | **zoom 8** |
| 0.6 x 0.45 deg | 2 | 6 | 12 | 30 | 90 | **zoom 10** |

Both stopped at exactly the last level fitting under 16 — not at the
compilation's own ceiling, which is zoom 11. **The generalisation is what opens
the gaps at contacts**, which this file already measured from the other end:
280 dark holes at zoom 4 and none at zoom 9, because at native scale the
polygons still share their boundaries. So the clip was manufacturing the very
gaps it was being blamed for.

**A level that cannot be covered is REFUSED and says so.** `levelFeatures`
returns `{ refused: true, needed }` rather than a partial answer, `maxTiles`
goes back to bounding only what is drawn, and a probe gets its own budget.

**And which resolution to ship is a CHOICE at clip time**, not a consequence of
a drawing constant. `DETAIL_PARAM` on the clip offers fast / balanced / full /
maximum against `TILE_BUDGETS` (16 / 96 / 320 / 1200). Named by what it SPENDS
rather than by a zoom, because the level a zoom buys depends on the box: zoom 11
costs 30 tiles over a 0.6 degree study area and 238 over a 2.8 degree one, so a
fixed zoom would mean something different for each.

Measured through the real path on one study-area box — and the last column is
the reported fault:

| detail | zoom | tiles | vertices IN the box | features clipped | isolated holes |
| --- | --- | --- | --- | --- | --- |
| fast | 10 | 12 | 4,444 | 176 | **10** |
| balanced | 12 | 90 | 4,956 | 342 | **2** |
| full | 13 | 288 | 6,448 | 654 | **1** |

Units clipped stays **13** at every level: no unit is lost, the same geology
arrives finer. The uncovered ground barely moves (25,953 → 25,945 cells) because
that is Lough Neagh and the sea, which are honestly unmapped — only the
ISOLATED holes, the contact seams, fall away.

**Count vertices INSIDE the box, never the totals returned.** A zoom-8 tile
spans 0.7 degrees and drags in far more surrounding ground than a zoom-12 one,
so raw feature and vertex totals FALL as resolution rises — measured, 35,643
vertices at zoom 8 against 23,746 at zoom 10 on the same box, which reads as
detail being lost when it is being gained. `detailWithin` exists for exactly
this and my first probe ignored it.

**The level shipped is now REPORTED.** `layer.featuresIn` used to drop
`got.zoom` on the floor, so which generalisation an extraction ran on was
invisible to everything downstream: a clip at zoom 8 and a clip at zoom 11 are
different maps and the app said the same sentence about both. It records
`layer.lastFetch` and the runner appends the level, the tile count and — when a
BUDGET rather than the source is what stopped the climb — the next level and
what it would cost.

**A param the RUNNER reads is named, never silently exempted.** `detail` is
chosen before any engine sees the inputs, so it cannot be read by one, and
`tool-runner.test.mjs`'s "every declared param is READ by its own tool" check
would have called it a dead control. `RUNNER_PARAMS` is that exemption written
down, with a second check that the runner really does read each name and that
each is offered as a real control with a valid default — or the exemption
becomes the loophole the original check exists to close.

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
## Full coverage: every polygon, every parameter, and no guess wearing a
## measurement's clothes

"We lean too heavily on published values" — right, and for a MODEL it is the
wrong trade. An honest null is fine on a card and useless as an input: a hole
in the input is a hole in the output, and a hydrogeological or landslide model
simply does not run over a polygon with no value. The database was **87.2% of
its parameter matrix filled**, and the gaps were almost all the SOILS, which is
most of what a landslide moves.

**Most of those were not missing, only unentered.** A cohesive soil has a real
unconfined compressive strength (qu = 2cu — clay 0.04–0.4 MPa, till 0.2–0.8,
peat 0.01–0.05); a cohesionless one has a real **zero**, because its strength
is entirely friction under confinement; and every soil has a published modulus.
Those are published values now, not estimates. Leaving them out is what made a
strength map blank over every alluvial fan.

**What remained is filled by a stated route, and the route is on the value:**

| basis | what it means |
| --- | --- |
| `table` / `compilation` | published. Untouched by the completion pass. |
| `relation` | computed from this material's OWN properties by a named rule — Mohr-Coulomb for UCS from c and φ, the Brazilian ratio for tensile, a modulus ratio for E, a drainable fraction for specific yield, a fracture factor for matrix conductivity. **35 cells.** |
| `analogue` | the range across every curated reference of the same class and state, median as typical. Data-driven, and the note names the group and its size. **3 cells.** |
| `not_applicable` | the quantity does not exist for this material. **39 cells.** |

**"Does not apply" is ASSIGNED, not blank.** A soil has no Hoek-Brown mi and no
GSI: those describe a jointed rock MASS, and a number for them over an alluvial
fan is invention rather than estimation. The cell carries the refusal, the
reason, and what to use instead — so a map draws it as its own class rather
than as a hole, which is the difference between "we do not know" and "the
question does not apply here".

**Every value carries a `confidence`** — high for a table, medium for a
compilation, low for a relation, lowest for an analogue, none for the prior
below — and a mixture takes the WEAKEST of the values behind it. The whole risk
of filling every cell is that an estimate comes to read like a measurement, so
the test asserts that no estimated value claims better than low and that every
one says how it was estimated.

### The last resort, and why it needed one

Measured on the live layer: **521 of 6,232 polygons in view carried a BLANK
`lith`** — every one from source 147, which ships no lithology in ANY column
(`descrip`, `strat_name`, `macro_units`, `liths` all empty; the names are ages
— "Neogene undifferentiated", "submarine continental crust"). There is no rock
named anywhere on the record, so unlike every other estimate in the file there
is nothing to derive FROM.

So there is an `unstated` reference: the whole database's range with its median
as the typical — a **no-information prior**, `confidence: "none"`, and the note
says the source named no rock. It is a `prior` rather than a `value` at every
step, and the map gives it **its own colour and legend row**, because the point
of having it is that a model gets a number while a reader can still see where
the prior is doing the work rather than the ground.

### Three faults on the way, all of the same shape

- **A not-applicable cell has no numbers**, and feeding one to the class breaks
  poisons the whole scale — `row.typical ?? (row.min + row.max) / 2` is NaN,
  `Math.min` over it is NaN, `hi > lo` is false, and the parameter silently has
  no paint at all. Three of sixteen parameters had no map.
- **A blank `lith` short-circuited before the prior could be reached.** The
  database had an answer waiting for exactly that case and 521 polygons still
  read "unknown".
- **`rows` was shadowed** inside the prior's loop — that name holds the
  lithology dictionary in that scope — so the file shipped
  `vocabulary.count: 45` (the length of the last parameter's pool) while every
  other count stayed right. A test comparing the declared count against the
  actual one caught it; nothing at runtime would have.

Vocabulary coverage went 99.4% → **99.95% of 11,000 map units** on the way
(landslide debris is colluvium — the worst thing to have left blank, and for a
landslide model the single most important unit on the map; ice and open water
are materials with their own entries).

**Measured live, 6,232 polygons, all sixteen parameters: 0 unknown.** 5,711
valued, 521 on the prior, and 319 not-applicable on the three rock-mass
parameters where the material is a soil.
## The geotechnical property database, and the map painted from it

For the hydrogeological and landslide models: a cited property range for every
lithology the world geology uses. `services/bake-rock-properties.py` →
`data/global/rock-properties.json` (270 KB), `gis/rock-properties.js` reads a
map polygon into it, `gis/rock-property-map.js` paints the streaming geology by
any of it.

**The key is Macrostrat's OWN published dictionary** — `/defs/lithologies`,
**214 names**, each with a class, type and group. That is what makes coverage
structural rather than sampled: every free-text `lith` string on the layer is
built from those names, so covering them covers the map at every zoom and in
every survey the compilation composites, rather than covering whatever happened
to be under the places somebody looked.

**Measured, because "structural" is a claim and not a fact.** Against 3,377
distinct `lith` strings pulled from twelve surveys' published legends, the 214
names alone resolve **98.2%**. The remaining 1.8% are three kinds of thing and
none is an error in the compilation: adjectival forms ("granitic rocks",
"dioritic-to-gabbroic rocks"), regional vocabulary the dictionary does not list
(**`siltite`, 264 uses**; `psammite`, `semipelite`, `metasandstone`,
`calc-silicate` — the British and Belt Supergroup terms), and rare rocks
(bronzitite, monzogabbro, trachybasalt). An alias table of 63 terms takes it to
**99.4% of 11,000 map units**. Ice, open water and "mainly blocks (landslide)"
are left unresolved on purpose: giving a landslide deposit a rock's strength is
the worst answer this database could give.

57 reference bodies carry values; the other 159 lithologies inherit, with the
parent and the rule recorded so the inheritance can be argued with.

### Three distinctions the file exists to keep

- **INTACT rock is not rock mass.** UCS, modulus and friction are core-in-a-press
  values; a slope fails through joints, bedding and weathering at one to two
  orders of magnitude less. `hoek_brown_mi` and a GSI range travel with every
  rock so the conversion is made deliberately rather than skipped silently.
- **MATRIX permeability is not formation permeability.** Granite: 1e-12 m/s
  intact against 1e-5 m/s fractured. Both are carried and the parameter names
  say which is which.
- **RESIDUAL is not peak.** On a surface that has already slipped, clay falls to
  6–12° — a third of peak or less (Skempton 1964). That is the number that
  decides a reactivated landslide, and it is carried with a residual cohesion of
  zero so a model cannot inherit peak cohesion by omission.

### Every value states its BASIS, and that is the honest part

`table` (transcribed from a table read while building this), `compilation` (a
standard published range, attributed), `derived` (a stated relation — E from
UCS × modulus ratio), `inherited`. The `table` entries are the strongest and
came from: **Hoek's Practical Rock Engineering** Table 3 (mi by rock group),
Table 2 (field strength grades R0–R6) and Table 8 (Deere's modulus ratios);
**Freeze & Cherry** Table 2.2 and 2.4; **Heath (1983)** USGS WSP 2220; and the
**BGS Mercia Mudstone report** (RR/01/02).

**The BGS National Geotechnical Properties Database corrected one of my
ranges**, which is the best argument for citing rather than recalling. Its
Mercia Mudstone report gives measured field permeability of **1e-6 to 1e-8 m/s
mainly parallel to bedding** against laboratory values of 1e-9 to 1e-11
perpendicular — two to three orders ABOVE the Freeze & Cherry shale range,
"because the mass permeability of highly indurated mudrocks tends to be
dominated by the presence of fissures". Taking the laboratory number for a
mudrock aquitard is how a groundwater model under-predicts flow through one.
The same report gives effective strength BY WEATHERING ZONE (Chandler 1969):
Zone 1 c'=28 kPa φ'=40°, Zone 3 17 kPa 42–32°, Zone 4 17 kPa 32–25° — a single
value for "mudstone" spans that whole profile, and the profile is what a slope
sits in.

### Reading a polygon into it

A MIXTURE IS THE NORMAL CASE. Most `lith` strings name two or more rocks, and
proportion words change the answer — `Major:{limestone}, Minor:{claystone}` is
the BGS spelling, "with subordinate shale" the prose one. Reading either as an
even mixture puts a mudrock's strength into a limestone's map at equal weight,
and mudrock is the constituent that fails.

**A log quantity is averaged in the LOG**, and hydraulic conductivity is why
that rule is here. Gravel (3e-3) and clay (1e-11) average arithmetically to
1.5e-3 — indistinguishable from the gravel alone, because an arithmetic mean
over eight orders of magnitude IS its largest term. The geometric mean is
1.7e-7, which is the answer and also what a hydrogeologist means by an average
permeability. Every parameter declares its own scale; the test asserts the
geometric answer AND that it is not the arithmetic one.

### The map is its own LAYER, in its own subtab

The first version put a "Colour by" select on the world geology's own row.
Wrong twice: it would have repainted the sheet somebody had loaded to look at
the geology, and it never appeared at all — the control was gated on
`layer.sourceSymbology`, which `import-manager` sets from a build result, and
the tiled geology is registered with a HAND-BUILT result that has none. So it
could not be found, which is exactly how it was reported.

**A rock-property map is a different MAP, not a different colouring.**
`gis/rock-properties-panel.js` is a "Rock properties" subtab beside Geology,
Tectonics, Volcanoes and Soil here; each property is a ROW, and ticking one
loads a SEPARATE layer with its own row in Workspace, its own legend, eye,
opacity and place in the draw order. The geology sheet is never touched and
both can be on the globe at once — which is the comparison anybody would
actually want. Rows rather than a select, because several are worth having at
once (strength over permeability, peak over residual) and a select expresses
one.

`loadDerivedGeologyMap` is the seam: the geology's OWN loader with a
`colourFor` supplied, so a property map streams, refines on settle, clips and
exports exactly as the sheet does.

**Two faults in one screenshot, and both are about what happens AFTER the
paint.** `loadTiled` paints at build from the entry's `colourFor` and then runs
one of three branches: a remembered style choice, `paintFromSource`, else
`applyField(entry.colourBy)`. A derived entry fell into the else and was
repainted by name a moment later — measured on a UCS map, **42.5% of drawn
vertices came back `#8a8a8a`** (the no-value grey) with the rest in the
twelve-class qualitative ramp, so a strength map looked like a broken geology
sheet. The paint was correct and was overwritten. There is a branch for it now
on BOTH the load and the refresh path, `colourBy` is dropped from the entry
rather than merely overridden, and the KEY is restored on both paths too —
it describes classes the layer's own features cannot be re-derived into, so
the first refine would otherwise drop the legend.

And `refreshDynamic` resolves its entry through `entryById`, which reads the
dataset catalogue — these maps are deliberately not in it. The lookup answered
null, the `if (entry)` guard skipped them, and a property map would have been
the one tiled layer on the globe that never refined as you flew in. `DERIVED`
holds them beside the catalogue.

Measured after, with the geology hidden so only the property map is drawn:
**0% of the drawn colour in the qualitative ramp**, every vertex either a
legend class or that class's own contact shade, and 5,350 of 6,232 units
carrying a published range at a 900 km view over northern Britain.

The cost is stated rather than hidden: a second layer is a second
triangulation of the same ground. The tiles are already cached so there is
almost no network in it, which is why these are opt-in rows rather than
something that arrives with the map.

### How the painting works

`paintByProperty(layer, key)` paints through the layer's OWN `repaint`, so the
tiles, the refine, the clip, the contacts and the export are unchanged — what
changes is what the colour means. Two rules:

- **Breaks are fixed over the whole database, never over the view.** A
  view-relative stretch would recolour the same granite depending on its
  neighbours, so the map would be about the neighbourhood rather than the
  ground — and a global view and a local one could not be read against each
  other, which is the whole point of having both.
- **A unit with no published value is left UNPAINTED and listed as such.** A
  soil has no UCS; a `lith` naming two classes at equal weight is refused
  rather than averaged. A coloured polygon reads as a measurement and a blank
  one reads as a gap, so filling the blanks with the middle of the range is the
  one failure this map must not have.

Verified live over Britain at a 700 km view: **10,912 of 11,814 units carry a
published UCS**, seven classes plus the unpainted row, and the picture is
geologically coherent — Highland quartzite and gneiss at the strong end, the
Carboniferous and Triassic basins at the weak one.

**`rampColour` answers `[r, g, b]`, not a string.** A vector repaint wants CSS,
and handing it the array is not an error: `THREE.Color.set` swallows it and
every polygon comes out white under a perfectly correct legend. `hex()` is the
conversion — this file's oldest trap, met again from a new direction.
## The geology card: what the rock IS, what it is CALLED, and its class

Clicking a world geology polygon gave a card headed **GEOLOGIC UNIT POLYGON**
— true of every polygon on the layer, and therefore saying nothing — over the
unit name, with that same name repeated as the subtitle. Measured, title and
subtitle were both "Unnamed Extrusive Rocks, Palaeogene".

The duplicate is one column reaching two slots. `popupTitle` falls through
`rock_type || interpretation || name`, and `rock_type` is built from
`props.rcs_d, props.rock_d` — **BGS columns, which Macrostrat does not have**
— so the title fell through to the name; then `metaParts` pushed the name
again, unconditionally. On a BGS sheet the two slots hold different columns and
it never showed.

Three lines, three statements now: the **classification** heads the card, the
**lithology** is the title (the one column that says what the ground actually
is), the **name** goes beneath. And the guard against saying the same thing
twice is on the TEXT rather than on any particular pair of fields, because
which column reaches which slot differs per survey and that is exactly what the
field-level version missed.

### The class is DERIVED, because the compilation ships neither half

`lith` is free text — "mafic lava and mafic tuff", "psammite and pelite",
"Major:{sandstone}, Minor{claystone,conglomerate}" — and there is no rock-class
column and no crustal-setting column. `gis/rock-class.js` is pure and tested in
Node against strings pulled off the live tiles, because **a classifier tested
on the phrasing its author imagined is a classifier tested on its author**.

- **Scored, not first-match.** A lithology routinely names two classes;
  "marble, meta-limestone" carries one sedimentary term and two metamorphic.
- **A tie is REFUSED.** "sandstone and basalt" is genuinely both, and a wrong
  rock class on a geological map is worse than an absent one — the card then
  falls back to the unit's name and says nothing it cannot support.
- **Word boundaries, because `tuff` and `tufa` are one letter apart in
  different classes** — volcanic ash against a freshwater limestone. A
  substring match files every spring deposit as igneous, silently.
- **A composition is not a rock.** `mafic gneiss` is a gneiss OF mafic
  composition; scoring the adjective as a noun made it a tie and then nothing —
  the single commonest miss on the live layer, **40 polygons**. Modifiers count
  half.
- **`meta-` a ROCK, never `meta-` anything.** The first rule was `meta` plus
  any three letters, which made "metalliferous sandstone" a tie: the prefix has
  to sit in front of a rock the module already knows.
- **Plurals**: a survey writes "carbonates, consolidated" as readily as
  "carbonate", and a word boundary after the `e` refuses the first.

**Oceanic against continental is an inference and the card says so.** Nothing
in Burwell carries a crustal setting — it is a compilation of LAND geology — so
it is read from the rock where the rock is diagnostic (an ophiolite is ocean
floor wherever obduction has since put it, which is why lithology OUTRANKS
position) and otherwise from the water depth here, at **2,500 m rather than at
the coast**, because continental crust carries the shelf and most of the slope.
A `Basis` row on the card names what each half was read off; neither is a
column, and a reader has to be able to tell an interpretation from its source.

The elevation comes through `window.GeoIDViewer.sampleElevationMeters`, not the
closure: `elevationSampler` is declared in the render scope and `openGeoPopup`
cannot see it — the ReferenceError this same function was already broken by
once, and the reason its whole body silently stopped running.

**Measured over 7,530 loaded polygons: 99.5% classified** — 2,284 igneous,
1,635 metamorphic, 3,571 sedimentary — with the 40 left over carrying no
lithology at all, where a null is the right answer. The first pass measured
98.8%, and reading the 92 misses is what found all three classifier gaps above:
**the residue of a classification is where its next fix is written down.**
## The full audit: the data was verbatim, the MAP was not

"Ensure the exported shp contains the contents of the clipped geology map
verbatim — might be clashing/overlapping values, so only extract those that are
actually visible." Audited a 52 km clip end to end: export, re-import, compare.

**The hypothesis was wrong and the report was right.** The data is verbatim —
**127 of 127 features, the COLOR column identical on every one**, no feature
lost, no attribute changed. And nothing is invisible: sampling each feature's
own bbox, **0 of 127 own no ground**, 3 are partly overlapped, 124 are clean.
(A first pass over one coarse 260x260 grid said "5 buried" — it was missing
small features between samples. **Sample a feature against its OWN bbox, never
against one grid for the whole layer.**) The overlap is real and modest:
**24.6% of the ground covered twice, never more than twice**, coarse survey 147
under fine 23 — the standing cost of keeping ground rather than losing it.

What was actually wrong was the STYLE, in three places:

**The contacts never travelled.** A geological map is its fills AND its unit
boundaries. Measured by reading the vertex colours off both layers: the source
drew **32 distinct colours** — 16 fills and 16 contacts, each its unit's own
colour darkened — and the re-import drew **16**, the fills alone, with
`getContacts()` returning `{shade, 0.62, 0.55}` on one and `null` on the other.
Every colour the import drew was one of the source's, so nothing looked wrong
until you looked for the edges. The QML also wrote a flat `35,35,35` outline
for every category, so the export opened in QGIS as the right fills under
near-black edges — a different map there too. Each category now takes its own
edge, and the mode rides in a QGIS custom property, which QGIS carries through
untouched and a style from anywhere else simply lacks.

**The shade is computed in LINEAR space**, because the renderer multiplies a
`THREE.Color` and those components are linear. Doing it on the sRGB bytes gives
a visibly different edge: #7bc771 at 0.62 is `98,161,90` linear against
`76,123,70` naive. The test pins the linear answer AND asserts it is not the
naive one, because both look equally plausible in source.

**The layer forgot which column it was coloured by.** `publishedColourField`
was short-circuited to null whenever a declared style did the painting —
reasonable, since a style that paints needs nothing inferred, and wrong,
because that field is also how a layer SAYS what it is coloured by. Two things
ask: `import-manager` sets `sourceColourField` from it, and `inheritedColouring`
reads it — so a clip of a re-imported map fell back to the ramp. **The round
trip was closed at one end and open at the other.**

**And so the Symbology dialog opened on a proposal wearing the clothes of a
report.** With no colour field to see, it fell to `ranked[0]`: "By attribute /
LITH — 20 values / qualitative", twelve classes and an `(other)` bucket holding
ten features — over a map with **nothing grey on it**. Apply would have carried
it out. That screenshot was the whole report, and none of it was the export.

**"Source colours" is the third mode**, and the one such a layer opens on. It
is neither a ramp nor one flat colour, so no classing this dialog performs can
reproduce it: `categoricalSymbology` ranks by frequency, keeps twelve and folds
the rest into `(other)`. The paint is the layer's own BUILD-TIME closure
(`sourceSymbology.apply`), so it cannot drift from what the layer originally
wore — there is no second derivation to keep in step. Its classes are listed and
locked (a source colour is a fact about the file; the two controls that invent
one are a select away), and any deliberate paint stands the mode down, so the
dialog never reopens on a mode the layer has left.

Verified on the committed build: **127/127 features, 32/32 drawn colours,
identical sets both ways, contacts `{shade, 0.62, 0.55}` on both**, the
re-import reporting `sourceColourField: "COLOR"`, and the dialog opening on
Source colours with 12 locked rows, no `(other)`, and "the colours the style
file declares, keyed on NAME".

**The general shape, for the fourth time in this file:** a round trip is only
as verbatim as the thing you measure. Feature counts and attribute values
agreed perfectly while the map on screen was missing half its ink. **Read the
drawn colours off the geometry of BOTH layers and compare the sets** — that one
measurement found the contacts, and the count of distinct colours is what makes
"the fills are fine" and "the map is fine" different statements.
## The corner you placed is the one part that was left behind

"When we lock in and save a drawn polygon it shifts/jumps South of its defined
position." Three earlier passes measured the SAVED layer — coordinates exact,
0 km drift — and concluded there was nothing to fix. The saved layer was never
wrong. The PREVIEW was, and only at part of itself.

`buildMeasureArcPoints` samples every interior point of the boundary through
`sampleMeasureSurfacePoint`, which reads the relief the globe is DRAWN with —
and then overwrites its two endpoints with `projectMeasurePoint`, which
returned the exact local hit point stored when the point was placed. That
position carries the radius it had at whatever exaggeration was live then, and
`getEffectiveTerrainRelief` tapers continuously as the camera descends.

Measured on a 27 km study area over Inishowen, viewed from 40 km:

| part of the boundary | radius | against a ground of |
| --- | --- | --- |
| the 156 SUBDIVIDED points | 3.23473 – 3.23507 | 3.23475 – 3.23562 |
| the four CORNERS (indices 0, 40, 80, 120) | **3.26207** | — |

52.6 km up, which is exactly the taper — and the four handle markers with them,
since `addMeasureMarker` projects through the same function. **The one part of
the shape the user placed by hand was the one part not re-sampled.** A corner
52 km above its own ground projects a long way from it at any obliquity, so
locking in and seeing the shape land on the surface reads as the shape jumping.

The fix keeps the two halves of that stored point apart: **the DIRECTION is the
one that was clicked, the RADIUS is today's.** The note the old code carried was
right about the direction — a lat/lon round trip loses XYZ precision on the
surface — and said nothing about the radius, which must move because the ground
does. The lat/lon is now used only to look the elevation up. The CTX mosaic path
keeps its exact stored radius: it blends real radii on purpose
(`useExactRadiusBlend`) and has its own tuned lifts.

Measured after, corner against the ground at its OWN coordinate: **0.000 km at
1500, 400, 120, 40 and 15 km**, through a taper from relief 0.11 to 0.018 —
about 180 km of ground movement. Preview and saved layer draw as one outline.

**Three measurement traps in one session, all mine, all worth not repeating:**

- **A vertex list without `matrixWorld` is not a position.** Marker discs are
  centred on the origin and placed by their matrix, so reading local positions
  reported every one of them at −6,300 km.
- **Min and max over a whole ring hide a single stale vertex.** The first read
  said "the overlay is 54 km up"; the percentiles said p75 = 3.23507 and
  p100 = 3.26207, which is a different fault with a different fix. **Print the
  distribution before believing a range.**
- **Radius is invariant under the spin; SCREEN POSITION is not.** Aiming the
  camera down a baseline `latLonToVector3` direction is fine for measuring
  radii and puts the shape thousands of pixels off screen. Aim at the object's
  own world centroid, and pause the spin.

And a fourth: a vector layer's `geometry.attributes.position` holds the
positions it was BUILT at (`REFERENCE_RELIEF`), because `followRelief` re-places
every vertex on the GPU. Comparing those against the ground reports the whole
taper as an error — 121 km, in this case, on a layer that is drawn correctly.

**The nine planet viewers carry the same override** and are NOT covered by
`port-draw-tools.py` (this code is outside its anchors). Their
`getEffectiveTerrainRelief` has no altitude taper — it returns 0 on the CTX
mosaic and the raw slider otherwise — so the ground only moves there when the
slider or the basemap changes, which is the same fault with a narrower trigger.
## A clip must wear the source's level, not derive its own

`zoomForBounds` answers from the BOX it is given, and a clip's refine box is the
study area's intersection with the view — smaller than the view the world layer
draws, so it lands on a different level. Macrostrat's `carto` composites several
source surveys and SWITCHES BETWEEN THEM by scale, so that is not a difference
in sharpness: it is different geology over identical ground. The controller now
publishes `getViewZoom()` and the clip asks for it.
## Measure after the load settles, not on the first frame

424 sample points inside one survey read as unpainted and I built two fixes on
it. Re-measured with the tiles given time to land, the same box read 98.5%
covered and pinning at zoom 8 or 12 drew the IDENTICAL 17,937 vertices. The gap
was tiles still in flight. Both fixes were backed out.
## Coverage is not correctness

A framebuffer diff against the basemap counts ANY painted pixel as covered,
including a flat slab of the wrong unit. The clip read 98.5% "covered" while
matching the world layer it was cut from on 21.6% of sampled points. When the
question is "does this look like the source", compare the two layers to EACH
OTHER, not each to the ground.
## Detail is not the thing to trade for coverage

Pinning the fullest-COVERING level took a clip from zoom 11 polygons to zoom 8:
flat blocks with straight edges where there had been real boundaries. It covered
the ground by making the ground coarse.
## Clip the units themselves, not the tiles they were served in

`carto` is a TILE service, and a tile is a cut of the map: a unit crossing a
tile boundary is delivered as two polygons meeting along a straight edge.
Stitching tiles can never reproduce the source outlines — measured on a 45 km
study area at zoom 13, the clip came back as 417 pieces in a visible lattice,
one unit ruled into two wherever a tile edge crossed it.

The tiles answer the cheap question well: WHICH units are on this ground. The
JSON API takes `map_id` in batches and answers with the mapped polygon, so the
ids go there and the clip is cut from those. Same box: 417 pieces became 70
whole units, none split, 100% coverage, all three surveys.

Ask only for the units the run can use — the borrowed set is the whole study
area, and fetching all of it asked for 2,475 units to draw 71.
## A clip is a window onto the merge, not a second streaming map

`clip-stream.js` gave the clipped layer its own tile controller so it would
refine like the map it came from. A tile controller draws exactly ONE level,
and the answer this source needs is multi-level by construction: `featuresIn`
fills each survey from ITS OWN deepest level. One level cannot hold that, and
every symptom followed from asking it to — 21.6% of sampled points matching the
map it was cut from, colours never inherited because the streaming path
returned before `inheritedColouring` ever ran. Deleted.
## Two vocabularies for a box is a silent skip

`areaOfInterest` answers in `minX/minY/maxX/maxY`; the tile side speaks
`west/south/east/north`. Reading the wrong one makes every comparison false —
no unit is ever "near", the fetch never happens, and the only sign is a missing
sentence in the message. Same shape as `controller.getContacts?.()` returning
undefined because the method was never published. Accept both, and test both.
## A contact separates two DIFFERENT units

Every polygon inks its own rings, so where two abut the shared edge is drawn
twice — and when both are the same unit, or two units the map paints alike,
that ink lands in the middle of what a reader sees as ONE area. Measured on a
45 km clip of Macrostrat: of 1,801 distinct segments, 717 divided different
colours and **265 divided identical ones**. The 265 are the only lines crossing
a flat field of colour, which is why a reader picks them out at once as
"outlines that don't exist in reality".

Walk the rings once first; ink a segment only where the polygons meeting along
it disagree about colour, and only once however many claim it. A third polygon
of another colour restores the contact, so a real boundary is never lost.

And do NOT gate that pass on `contacts`: the seal inks rings whenever the layer
is coloured, and a clip built through the tool carries no contact style at all
— which is exactly the layer the phantom lines were reported on. Gated, the
dedupe fired (2,784 → 1,801) while all 265 phantom divisions survived.
## Fetching whole units reintroduces overlap the tiles had already resolved

`carto` picks ONE survey per scale, so a tile carries a single survey's
polygons over any given ground — which is why an earlier tile-based measurement
found 1 of 4,900 sample points double-covered and concluded the surveys mosaic.
They do not. Fetching whole units from the JSON API brings every survey back on
top of each other: **80% of the same clip covered by more than one survey**,
2,888 of 4,900 points by all three. Drawn flat, a regional survey's boundaries
are ruled straight across the detailed survey's geology.

Rank by VERTICES PER UNIT AREA — boundary detail per unit of ground, which is
what "more finely mapped" means, and derivable from the features themselves
(`/defs/sources` answers empty for these ids). On that clip: survey 23 at
14,624 with 51 units averaging 0.0031 deg2, against 154 and 147 at 1,549 and
1,008 with 4 and 15 much larger units.

Higher rank wins: fill drawn last, and a coarser contact not inked where a
finer survey covers it. The coarse survey still shows where the fine one does
not reach — measured, 1,286 of 3,600 points, which is the offshore geology, and
0 points left bare. The rank must ride through every repaint, or the next
symbology change brings the coarse boundaries back.

A measurement made on tiles does not answer a question about the source.
## The picker and the painter must agree about who owns the ground

Survey precedence is not only a drawing rule. `featureInLayer` returns the
FIRST feature whose polygon contains the point, and `polygonIndex` — the
sampler behind extraction and the geology readout — is built from the same
array in the same order. Fix the drawing alone and a click on ground the fine
survey holds still returns a regional unit that is not even the one on screen:
reported as selecting "Mesozoic sedimentary rocks", 409 km2 from survey 154,
over detailed geology.

The two orders are OPPOSITE. Drawing wants coarse first, so the fine fill lands
on top; picking wants fine first, so the first containing polygon is the right
one. The renderer sorts its own iteration ascending by rank, which leaves the
feature array free to carry the descending order the pickers need. Measured
after: 1,028 of 1,028 points on fine-survey ground pick the fine survey.

Whenever precedence changes, ask what else reads the feature list in order.
## "Same colour" is not "same unit"

Suppressing every same-colour shared edge deleted real contacts: this source
paints many different formations alike, so the rule removed boundaries that
genuinely separate two units and the WORLD map lost outline detail it had
always drawn. Measured on the world layer's own features — 2,044 features,
23,143 distinct segments, 9,587 shared — the colour rule would have deleted
**1,863 real contacts**, while keying on the unit suppresses **4**.

Identity is `map_id`, else `legend_id`, else the name, and a feature with no
identity is always drawn. That is the tile-cut and multipart case the rule was
written for, and nothing else.

The test reimplemented the rule locally and kept passing against a copy of
itself — the same trap as the level-picking test. A test that re-derives the
behaviour it is checking proves only that the copy agrees with itself.
## The coarse survey's ground is taken away, not merely covered

Drawing the finer survey on top leaves the coarse polygon in the picker, the
attribute table, an export and the area sums — measured, 3,155 of 3,156 sample
points on detailed ground still had a regional polygon underneath. Dropping
only the WHOLLY covered ones fixes almost none of it, because a coarse unit
running offshore is only partly covered.

Use `geoprocessing.difference`, never `geometry.booleanOp`. Measured against a
coarse 2x2 square: `booleanOp` with a finer square in the CORNER, sharing two
edges, returned EMPTY and deleted the polygon whole — three units of real
ground — and with one strictly INSIDE cut nothing at all, a hole being
inexpressible as one ring. `difference` gets both right; its one failure is not
cutting when two share an edge exactly, which keeps ground rather than losing
it. After it: overlap 3,155 -> 1,540 points, coverage 99.94%.
## Resolution does not fall with a clip's extent — check composition first

A clip's vertices-per-km2 fell 4.10 -> 2.97 -> 1.92 across 15, 45 and 90 km
boxes, which reads as a large extent losing detail. Per SURVEY it is flat: the
detailed survey is found at 317, 396 and 374 units per deg2. The decline was a
bigger box taking in more coarse-only offshore, and the geometry is verbatim
from the API, so a unit's detail never varies with the level it was found at.
Forcing the full tile budget bought 4% more vertices for twice the runtime and
was reverted.
## The dot, the card and the outline are one answer

The pin's stem is gone: with a card that points at the dot and an outline that
breathes, a line between them was a third thing to read. `.geo-popup-anchor`
keeps its dot (`::before`) and loses its body.

Both cards point. The world card aims its tail by `(w/2) + (sx - px)` — the
difference between where the card ENDED UP and where the ground actually is —
so a card pulled back inside the view still points at the point; the tail flips
edge with the card. The clipped card is placed beside the click and can end up
on any side of it, so all four edges are declared and the offset picks one.

Both outlines pulse, phase taken from the CLOCK rather than from when each
began, or two units selected moments apart beat out of step and read as two
answers.

And marking what was picked belongs to the PICK, not to whoever draws the card.
Geology is handed to the viewer's own card, and that branch never lit the
ground — so a click raised a card and left the reader to find which of several
hundred polygons it meant. The labelled path already followed this rule; the
geology path now does too, and the dismissal branch had to learn that a geology
hit is not "nothing".
## Which survey is finer is the publisher's answer

Filling the hole with the coarsest survey was a RANK INVERSION, not a filling
strategy. `surveyRanks` scored surveys by vertices per unit area, which
measures how geometry was DELIVERED rather than how finely ground was mapped —
and over Inishowen it inverted: source 154 scored 1,157 against source 147's
797, because 147's units had been swapped for smooth verbatim API shapes while
154 was still ragged tile pieces. The regional map then outranked the national
one and cut it away: 147 fell from 97.3% of the box and 100% of the north-west
quadrant to 16% and 22%, and 154 filled what was left with flat polygons over
ground a better survey had already mapped.

Macrostrat composites several surveys and **switches between them by scale**,
so the deepest zoom a survey is served at IS its scale. Measured on one tile
stack over Inishowen: zoom 13 serves nothing, zoom 9 serves only source 23,
zoom 6 serves 7, 23 and 147. `featuresIn` already tracks this per survey in
`deepestFor` — to fill each survey from its own best level — and then threw it
away. It now returns `sourceZooms`, `lastFetch` carries it, and `register`
hands it to `surveyRanks`. Over this box: `{2:3, 7:6, 23:13, 147:8, 154:2}`.

Only used when it places EVERY survey present and separates them: an unplaced
survey would rank 0 and be cut by everything, and one zoom for all of them
says nothing. Both fall back to the geometric measure.

After: box coverage 100%, north-west quadrant 100%, source 154 dropped from the
output entirely, 147 covering 98.3% of that quadrant at verbatim geometry, and
the picker returning the finest survey on **529 of 529** overlapping cells. The
cost is 33.1% of the box double-covered, because a coarse feature that cannot
be cut safely is kept whole underneath.

**Macrostrat has nothing finer than zoom 8 over Donegal.** Source 23 (zoom 13)
stops at the border, so the west half of a cross-border study area is source
147 at its own best level and there is no more detail to fetch. That is the
source's coverage, not a fault in the pipeline — check `sourceZooms` before
chasing it again.
## The contacts were drawn all along, in the one invisible colour

"Ensure the outlines are included on the clipped geology surface" was not a
missing pass. The clip had 4,286 line vertices and drew them at **#FF9ACC on a
#FF9ACC fill**, while the world layer beside it inked the same boundaries at
#B86790. `renderFeatureCollection`'s contact mode defaults to `"match"` — the
polygon's own colour — which is correct for a catchment or a coastline and
wrong for geology, where the contact IS the information.
`buildVectorLayerResult` never accepted a `contacts` style, so every derived
layer took that default.

It now takes one, holds it on the LAYER (like `fillMode`, and for the same
reason: a style passed per paint is lost the first time anything else
repaints), and the tool runner INHERITS it from the input's tiled controller
rather than choosing one — the same pattern as the colour column.

The panel's contact selector also had to learn about derived layers:
`loadedLayers()` filters on `geologyDataset`, which a clip does not carry, so
the control moved the tiles and left every clip drawn the old way.

Measured after: clip style `{shade, 0.62, 0.55}` identical to the world layer's,
strokes #7BAEB1/#537252/#672674 against fills #99D8DC/#678E66/#802F91, and
**zero** strokes equal to the fill they bound. Driving the panel's own selector
to "ink" restrokes the clip flat at #1B1620 and back again.

Unrelated wrinkle noticed while testing: the FIRST render writes a feature's
colour straight through, a repaint puts it through `THREE.Color`, and the two
encode the same colour differently. Harmless here, but do not compare a
built layer's bytes against source hexes — compare against that build's own
fills.
## Click accuracy on clipped layers, measured

The clipped layers were already picking correctly: `gis/feature-popup.js` asks
`viewer.surfaceLatLonAt`, which goes through `intersectAnySurface` and has been
refining its globe hit onto the relief all along. It was the VIEWER's own
geology path that used the unrefined `intersectMarsSurface` — see the entry
above. Verified rather than assumed, on a 47 km clip of 96 features:

- **323 of 323** sampled screen points return the polygon that actually
  contains that ground (`featureAt` against a point-in-polygon of the layer's
  own features). No misses, no wrong units.
- Real clicks put the card's dot **0–5.5 px** from the cursor, and the residual
  is the globe turning during the one-second settle — about 2.3 px/s at this
  zoom.

One inconsistency was closed: `showFeatureCard` built its anchor with a 0.0008
lift — **1.6 km** — while the highlight outline for the same feature sits at
nought, so the dot and the outline disagreed at oblique angles. The anchor is a
DOM element positioned by projection; it has no depth test to win and needs no
clearance.
## The ribbon seal

The seal is now a quad per boundary segment, laid flat in the tangent plane and
widened on the GPU from a uniform that follows the camera — about three
quarters of a pixel of ground either side, so it spans ~1.5 px at any altitude.
Measured half-widths: **1,769 m at 2,400 km, 299 m at 300 km, 61 m at 60 km,
9 m at 12 km** — the gaps shrink with the zoom and so does this.

Background pixels inside the map, seal hidden → ribbon on, same view and same
tiles: **4 → 0** at 2,400 km, **67 → 0** at 300 km, **14 → 0** at 60 km,
**73 → 7** at 12 km. Note the "before" there is *no seal at all*, which is a
harsher baseline than the one-pixel line it replaces — the line already covered
part of these.

The cost is what it repaints: **23–26% of the frame at coarse views**, 0.26–0.36%
close in. That is not smearing, it is boundary density — at 2,400 km a 1.5 px
stroke on every contact genuinely covers that much of the screen, and the old
line covered about two thirds as much for the same reason.

Two implementation notes that will bite anyone editing this:

- The seal is a **Mesh** now, so "is it a Mesh" no longer separates a fill from
  an edge. It carries `userData.geoidSeam`, which does — two tests identified
  it by three.js type and had to be corrected.
- Being triangles it is double-sided and depth-free for the FILL's reasons
  rather than the line's: the shader discards fragments facing away, so the far
  hemisphere is culled without a depth test that a facet coplanar with the fill
  could never win.

`aPerp` is the segment direction crossed with the outward radial — a tangent —
so widening can never turn into altitude. Zero-length segments are dropped:
`pushSegment` can hand back a repeated point and a zero cross product would be
NaN and take the whole draw call with it.
## The world's soils are a MAP now, and the highest resolution is not a polygon

"Swap the SoilGrids tab for a global soil polygon map, implemented like geology
and ice cover — and find the highest possible resolution." The second half of
that turns out to argue with the first, and the measurement is what settles it.

**THE HIGHEST-RESOLUTION GLOBAL SOIL PRODUCT IS A RASTER.** SoilGrids (ISRIC)
is 250 m against the FAO map's 1:5,000,000, its WMS at `maps.isric.org` answers
CORS `*`, and its capabilities advertise `application/vnd.mapbox-vector-tile` —
which looks like polygons at 250 m until you ask for one. Measured: the
`MostProbable` layer returns **0 bytes** as MVT and a perfectly good PNG (21
classes over Ireland) as an image, because MapServer only vectorises vector
layers and this is a raster. GLDAS is coarser still; HWSD v2.0 is 30 arc-second
and also a raster.

So "a polygon map" and "the highest resolution" are two different products, not
one. This is the polygon map; the 250 m raster is its companion and belongs on
the drape path. Handing over a raster wearing a polygon map's clothes would be
the same claim-a-precision-you-do-not-have fault the terrain tool's native
sampling note already records.

**The source is the FAO/UNESCO Digital Soil Map of the World** — 34,112
polygons, 123 dominant soil units, `services/bake-soil.py` into
`data/global/soil` — and it is an ordinary tiled vector layer, so the click
card, the legend, symbology, clipping, extraction, zonal statistics and export
all work on it with nothing added. That is the whole argument for the swap: the
old card sampled ONE POINT, so you could not see where a soil began or ended,
clip to it, or lay it beside the geology under it.

### Four things the source taught, each of which is a wrong map if assumed

- **FAO'S OWN NAMES ARE IN THE `.lyr`,** and they are read rather than
  remembered. The download ships an ESRI layer file whose labels are plain
  UTF-16LE, carrying the legend in TWO shapes — `Af-Ferric Acrisols` (code
  first) and `Water Bodies (WA)` (code last). Reading only the first names 117
  of 123 codes and leaves water, ice, rock, salt, dunes and no-data as bare
  abbreviations: **5,505 polygons, a sixth of the map**.
- **THE DATA AND THE LEGEND DISAGREE ABOUT ONE CODE.** The polygons say `WR`
  for water; the legend writes `WA`. Unaliased, 3,350 polygons — every lake and
  inland sea — came through unnamed, which reads as a hole in the legend rather
  than as a spelling.
- **COLOUR BY THE CODE'S FIRST LETTER, NEVER BY THE GROUPING'S NAME.** The FAO
  legend is systematic — the first letter IS the major grouping — so a letter is
  an exact key that needs no spelling. Keying on the name cost eight units their
  colour, for two separate reasons: a grouping with ONE unit has no capitalised
  row at all (Lithosols is just `I`, and it is the commonest unit on the map at
  4,266 polygons, every one drawn in the no-value grey), and **FAO's own legend
  is misspelt twice** — `KASTAZNOZEMS` and `VERTSOLS`. Both corrected for
  display in a named table, so the correction is arguable rather than silent.
- **FAO WRITES -1 FOR "NOT MEASURED",** and it reached the map: a card read
  "bulk density -1", which is not a low density, it is an absence wearing a
  number's clothes. Same family as `Number("")` being 0. All six kept
  properties are percentages, a pH or a density, so none can be ≤ 0 and one
  test covers them.

### Banded by SIMPLIFICATION, not by selection — the opposite of the glaciers

The glacier bake drops small complexes at coarse zooms, which is right for a
SPARSE subject: ice is islands in an empty sea. Soil is CONTINUOUS, so dropping
a polygon does not thin the map, it puts a HOLE in it — and a hole in a soil
map reads as "nothing here" about ground that certainly has soil.

What is genuinely wasted at a coarse zoom is VERTICES. Baked flat the pyramid
came out at **43.9 MB with a 4.2 MB world tile**, which is the glacier bake's
own measured fault reproduced exactly (33 seconds of world tiles before the
view's own were requested). Simplifying per band — every polygon surviving at
every level — took it to **26.8 MB with a 1.8 MB world tile**, and each
tolerance is a fraction of a PIXEL at its band's coarsest zoom.

**And the ceiling is the SOURCE'S, not the format's.** The glaciers go to zoom
6 at extent 8192 because RGI is digitised from 15-30 m imagery. This map is
1:5,000,000 — its own positional accuracy is a couple of kilometres — so zoom 6
at 8192 was placing vertices to about 32 m: megabytes of a precision FAO never
claimed. Zoom 5 at the 4096 convention is ~300 m at the equator, still an order
of magnitude finer than the source.

### What left with the card, stated so it is not missed

The SoilGrids card derived a **screening strength** (φ′ and c′ from clay and
sand) and flagged **peat** — organic carbon over ~120 g/kg, where the material
on the slope is not the mapped bedrock and a strength from a lithology table
describes the wrong thing. `fetchSoil` and `strengthFromTexture` are still
exported and still tested in `earth-data.js`; only the card is gone. FAO's own
topsoil texture, pH, organic carbon and bulk density now ride on every polygon,
so the same derivation can be put on the map's card whenever it is wanted.

**A HOME MAY BE SERVED ENTIRELY BY THE TILED REGISTRY.**
`catalogue-panels.test.mjs` checked that every home in `HOMES` holds a shipped
dataset, which was right while every home had files in it — a baked pyramid is
not a file, so `global-data.js` cannot describe it and the soil home has none.
Counting one of the two sources called a fully populated tab empty. The
invariant that matters is unchanged: no home is a heading over nothing.

### A soil is not a rock, and the card had to be taught twice

Clicking a Podzol opened the geology card, which headed it **CONTINENTAL**
(`crustalSetting` answering from the ELEVATION about something that is not
crust), titled it **"Unit"** (the geometry noun, since a soil polygon has no
`lith` column for `lithologyLabel` to read), and then printed **sixteen
rock-mechanics parameters** about it — uniaxial compressive strength,
Hoek-Brown mi, Geological Strength Index, slake durability. Every number
correct for what it claimed to be, and none of it true of the ground clicked.

The route in is worth stating: the rock-property lookup falls back to
`lithology || geometryName`, so a soil fell through to "Unit", the database
found nothing, and its NO-INFORMATION PRIOR filled the fold. A prior exists so
a model gets a number over unmapped ground; it is not a licence to answer a
question the material does not have. `gis/soil-card.js` writes the three lines
instead, and `lithForProperties` is refused outright for a soil — the same
shape as `not_applicable` in the rock database, and for the same reason.

**AND WIRING IT INTO `feature-popup.js` ALONE CHANGED NOTHING AT ALL.** The
card went on reading "CONTINENTAL / Unit" over the same sixteen parameters,
because the picker that answers for a tiled geology layer is the VIEWER'S own
(`#geo-popup`, fed by `geology-panel.js`'s feature builder), not the GIS stack
card. Both builders need the branch — `ice-card.js` is used from both for
exactly this reason, and the second call site is easy to miss because the first
one looks like the whole job. **A card that exists in one of two builders is a
card that does not exist.** This is the fourth instance in this file of "the
button you are pressing is not the code you changed".

**A bare code is worse than no line.** The meta read `Re33-1a · 06`, where `06`
is FAO's phase code — and nothing in the download names the phases: the `.lyr`
that names every soil unit has no phase list, and neither does any workbook.
Dropped, on `rock-class.js`'s own rule: an abbreviation beats an inferred name,
and no line beats an abbreviation that names nothing.

**AND EVERY DERIVED MAP WAS CREDITING MACROSTRAT.** `loadDerivedGeologyMap`
spreads `GLOBAL_BASE`, whose `credit` is the Burwell compilation's — so the
card over a soil polygon cited "Macrostrat Burwell compilation, CC BY 4.0 —
each polygon carries the survey that mapped it" over FAO's map, and **the
glacier inventory had been citing it over RGI's outlines for as long as it has
existed**. Naming the wrong publisher is the one error a licence-conditional
dataset cannot absorb. The function takes a `credit` now, `undefined` inherits,
and both derived maps state their own.
## GLiM: the third global polygon map, and the DOI that is not the map

Three global polygon maps now, and they answer different questions rather than
competing — worth stating plainly, because two of them sound the same:

| layer | what it maps |
| --- | --- |
| World geology (Macrostrat) | the BEDROCK — the formation, named and dated |
| Soils of the world (FAO) | the SOIL that formed on it |
| Surface lithology (GLiM) | the ROCK AT THE SURFACE, by lithology |

**THE DOI EVERYONE CITES IS NOT THE POLYGON MAP.** `10.1594/PANGAEA.788537`
publishes GLiM's **0.5 degree GRIDDED** version — a 38 kB zip holding one ASCII
grid and a list of class codes. Half a degree is about 55 km, so it is far
COARSER than the 1:5,000,000 FAO soil map already on the site, and baking it
would have been a step backwards wearing a DOI. Its abstract describes the
1,235,400 polygons, which is what makes the record so easy to mistake for them.
The polygons are an ESRI file geodatabase linked from the authors' own project
page at Hamburg — **1.1 GB** — and `bake-glim.py` reads that.

### Three things the source taught that the FAO map did not

- **IT IS PROJECTED, NOT GEOGRAPHIC.** The geodatabase is in World Eckert IV,
  an equal-area projection in METRES, where the FAO shapefile was plain degrees
  with no `.prj` at all. Baked without `-t_srs`, every polygon lands at
  coordinates in the millions. `-wrapdateline` goes with it, or the polygons
  straddling the antimeridian come back as ribbons across the whole map — the
  same seam `bake-stress.py` had to cut by hand.
- **THE NAMES ARE IN A `.lyr` INSIDE THE GEODATABASE.** `GLiM_v1_1.lyr` carries
  all sixteen level-1 classes as `Unconsolidated Sediments (SU)` — the same
  `Name (CODE)` shape the DSMW's miscellaneous units used. Read, not
  remembered, exactly as FAO's are. It abbreviates two of them to fit a printed
  key ("Intermediate Plutonic R."), expanded in a named table.
- **`Litho` IS THREE LEVELS IN ONE STRING.** `scpu__` is carbonate sedimentary
  (`sc`) plus a level-2 and a level-3 subclass, underscore-padded. Only level 1
  has published names, so that is what the map is drawn and legended by; the
  full code rides on the feature.

**A GLiM UNIT IS A ROCK, and that is the difference that decides the card.**
The soil map needed one of its own because rock-mechanics properties do not
apply to a Podzol. These polygons ARE rock, so the bake writes each class name
into **`lith`** — the column the geology card heads itself with, `rock-class.js`
classifies from, and the rock-property database looks material up by — and they
go through the ordinary path with nothing added. `isSoilFeature` cannot claim
them: it requires the FAO map's `unit` column, which GLiM has no equivalent of.

**Its "Ice and Glaciers" class must NOT be filtered out.** The geology layer's
own ice predicate exists to keep ice out of a map of rock; here ice is a mapped
class OF the lithological map, and removing it would put a hole in Greenland.
`featureFilter: null` says so.

### A BAKE'S SCRATCH IS NOT A DELIVERABLE

**376 MB of the soil bake's working directory reached a commit** — the
intermediate GeoJSON twice over (138 MB + 131 MB), the extracted shapefile, the
source zip and the tile bands, 578 files — on a repo already over the Pages
limit. Nothing failed and nothing looked wrong: `git status` was clean, which
is exactly what being fully committed looks like.

`data/global/.*-work/` is ignored now and `.soil-work` untracked, taking the
tracked bytes under `data/global` from 575 MB to 199 MB. The pyramid under
`data/global/<name>/` is the artefact; every bake script recreates its own
scratch from the source. **Note the history still carries those objects** —
untracking stops them deploying and stops them growing, and shrinking the pack
is a rewrite, which is a separate decision.

GLiM makes the point sharply: its working directory is the 1.1 GB download, a
3 GB reprojected GeoPackage and the tile bands, none of which belongs anywhere
near a commit. `to_wgs84` REUSES an existing GeoPackage for the same reason —
reprojecting 1.2 million polygons out of Eckert IV is the expensive half by a
wide margin, and every tuning pass on the tile bands would otherwise pay it
again.

### An unreachable pyramid drew empty ground and said it was fine

Found while planning the move of the baked maps to object storage, and it is
the single thing that plan most needed: GLiM's row was committed before its
tiles were, so for one afternoon the app had a layer whose pyramid genuinely
was not there — which is exactly how a bucket that is down, a CORS policy that
is wrong, or a custom domain that has not propagated will present.

Measured, with the tiles missing: the layer REGISTERED, drew nothing, and the
status line read **"1,235,259 polygons over 16 classes… 0 in view; it sharpens
as you fly in"** over Africa. A confident sentence about a map that had not
loaded, which is the worst of the three available outcomes — worse than an
error and worse than blank.

Three faults stacked, each hiding the next:

- **`loadManifest` answers `null` on any error**, and `loadTiled` then built a
  controller with `has: () => false` and no remote — which sends every tile
  down `loadTile`'s *"a tile that was never baked, on a pyramid with no remote,
  is EMPTY, not a failure"* branch. That rule is RIGHT per tile (the glacier
  pyramid is sparse by nature; most tiles of any view hold nothing) and
  catastrophic for a whole missing manifest. An own-tiles layer now refuses and
  says so. The world geology is deliberately exempt: it falls through to
  Macrostrat, so a missing manifest there means "ask the source".
- **The status line typed its own totals.** "1,235,259 polygons over 16
  classes" was a literal — a claim about the SOURCE printed whether or not
  anything loaded. It is counted from the table the bake wrote now, so the
  sentence and the file cannot disagree.
- **The tick stayed ON, and the reason was reported into another subtab.**
  `say()` in the geology panel writes to `#gis-geology-status`, because that is
  where the loader lives — while the row lives in Soil and surface materials.
  So a reader ticked a box in one subtab and the explanation appeared in
  another. `catalogue-panels`' add path checks `layerOf()` after `load()`,
  reports into the row's OWN host, and redraws so the tick follows the truth.

Verified after, with the pyramid still absent: tick returns to off, the message
lands beside the row, nothing registers. **`layerOf()` is the truth about
whether anything reached the globe — a control's state has to be read back from
it, never from the press that was made.**
