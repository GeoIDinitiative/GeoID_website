# Ice, imagery over time, time windows and time-lapse

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## Imagery over time: its own sequence, and ONE player behind both

"A separate time animation devoted solely to the imagery over time — no
polygons (can be overlaid in workspace though)." Two things came out of that,
and the second is the one that matters for anything added next.

**`gis/imagery-timelapse.js` is the film**, a subtab in **Basemaps** — where
imagery already lives, since the base textures, the tile services and Earth
Engine's imagery share are all in that tab. A box, a range of dates, one
composite per step, and nothing drawn over it. Overlaying is free and needed no
code: a frame sits at renderOrder **45** and the imported band starts at 50, so
anything in Workspace draws above the film by construction — measured, a drawn
study area at **51** over frames at 45.

**`gis/timelapse-player.js` is the player, and there is one of it.** The bar,
the slider, the play loop, the scene cache, the swap-on-ready, the prefetch,
the GEE→GIBS→none fallback and the four bbox vocabularies were all in
`glacier-timelapse.js`; a second animator built by copying them would have
drifted the first time either was fixed — the polygon-area formula in ten files
and the imitated label engine are what that costs. The glacier file kept only
the half that is about ICE. A driver hands the player a box, an ordered list of
epochs (`{date, from, to, dataset}`) and OPTIONALLY one scene-graph node per
epoch; the imagery driver passes none, and that is the whole of "no polygons".
One player also means one bar: starting either animator stops the other, and
closing the bar runs the driver's own `onStop` — which is what takes the
glacier outlines off the globe with it.

The tests pin the discipline rather than trusting it: neither driver may build
a style tag, call `fetchScene` or composite a tile, and the imagery driver's
`startPlayer` call must carry no `frames`.

### What the imagery driver decides, and why each way

- **A frame is a WINDOW, not an instant.** A single day is one overpass and
  mostly cloud; Earth Engine's answer to a range is the cloud-masked composite
  anybody would otherwise build by hand. Steps are yearly, monthly or daily,
  and a yearly step may take the whole year or that year's **melt season** —
  the player's own hemisphere-aware rule, shared with the glacier animator,
  because over ice a whole-year composite is mostly the winter snow that hides
  the subject.
- **Every window is CLIPPED to the range asked for.** Without it, 2016-06-01 to
  2016-08-31 stepped yearly composites the whole of 2016 and presents twelve
  months as three.
- **A long range is STRIDED, never truncated.** A time-lapse is about a span,
  and cutting it off at frame 40 quietly changes which span it is; the far end
  is kept whatever the stride lands on, and the stride is REPORTED ("one in
  every 12 months") — a sequence stepping a year at a time under a control
  saying "monthly" is exactly the silent cap this file keeps paying for.
- **A pinned collection REFUSES rather than substituting.** Only "best for each
  year" may fall back to GIBS: quietly serving 250 m MODIS where 10 m
  Sentinel-2 was asked for is the sensor change the choice exists to prevent —
  a change that is really a change of instrument is the easiest false reading a
  time-lapse can produce.
- **The years a collection flew are carried** (`since`/`until`), so the panel
  says "15 of these 21 frames are before Sentinel-2 began" BEFORE anybody
  spends twenty-one requests finding out.
- **Any Earth Engine dataset id may be typed in**, and it wins over the
  dropdown: the service renders anything in Google's published catalogue with
  that publisher's own visualisation, so night lights, NDVI or burned area play
  here exactly as true colour does.
- **The bar says a frame's window ONCE.** Earth Engine answers with the window
  it actually used, so a note that always prefixed the asked-for one carried the
  same pair of dates twice in a field that ellipsises at 15rem — and the case a
  reader needs both for, a window the service narrowed, looked identical. The
  prefix is added only when the source has not already said it.

### The world clock stands down while a sequence is up

The corner pill (LIVE / ×720 / paused) and the seven-segment clock report the
MODEL's moment — the wall clock the globe spins on and every fetch is stamped
in. A time-lapse runs on its own clock entirely, and the two on screen together
say that "2020" and "01/09/26 19:47 UTC" are both the time being shown. So the
player hides `#time-rate-toggle`, `#time-scrub-toggle` and `#time-scrub-panel`
while a sequence is up and puts them back when it closes — including when the
OTHER animator takes over, since starting either stops the one running.

- **An inline `display`, not the `hidden` attribute.** These are laid out by id
  rules in `styles.css`, and `hidden` is only a UA-level `display: none` that
  any author rule outranks — the trap the symbology dialog and the Research Hub
  have both paid for. The previous inline value is stashed and restored, so an
  element that was already hidden for another reason stays that way.
- **The spin is held too**, and not merely because the pill that stops it is
  gone: a sequence is about one box, and a globe turning at 3°/s walks it off
  the limb while somebody is reading it. Through the viewer's own
  `setSpinPaused`, the seam `holdTheGlobe()` uses, so nothing turns the globe
  from outside and the corner pill stays truthful.
- **Restored, never forced.** A reader who had the globe stopped before
  pressing play does not want it turning afterwards. Measured both ways: from
  spinning, the sequence pauses it and closing resumes it; from already paused,
  closing leaves it paused.

Verified live over a Valais box: GIBS 2016–2020 yearly built 5 frames with
**one drape visible per frame at renderOrder 45 and zero layers added**, and
re-visiting a frame fetched nothing; Sentinel-2 2018–2020 on melt seasons
returned three real Earth Engine composites; the glacier animator still ran 24
dates through the extracted player, its ✕ took its outlines with it, and
starting the imagery sequence left exactly one bar on screen.
## Ice is not geology, and a card that knows sixteen things has to fold

Three changes, one report: separate the ice cover, keep one popup across the
geology and rock-property maps, and put the metadata and the properties into
expandable subtabs inside the card.

**The ice sheets were IN the geological map.** Macrostrat ships them as
ordinary polygons in the same tiles — named "Phanerozoic ice", carrying a
BLANK `lith`, so the column that says what the ground is says nothing — and
measured on the live layer they are **13 of 53 features over Antarctica,
24.5%**, with 33 more over Greenland. A geological map of those places was
substantially a map of what is lying on top of the geology.

`gis/ice-cover.js` is ONE predicate used three ways: the geology layer streams
everything it says no to (`isNotIceCover` on `GLOBAL_BASE`), the Ice cover
subtab streams everything it says yes to, and both come off the same tiles and
the same cache. The tiler applies it in `clipped()`, which is the one path
feeding the drawing, `features()` and `levelFeatures()` — so it governs the
picker, extraction and clipping alike rather than only the picture. Measured
over Antarctica: geology 40 features with **0 ice left in it**, the ice layer
13, all 13 ice.

- **It matches on the NAME, and only because the lithology is empty.** These
  units state no lithology at all, so the unit's own name is the only thing
  that says what it is. `lith` is still checked first: a survey that does
  state one should be believed over a name.
- **A glacial DEPOSIT is geology and stays on the map.** A till is a soil with
  a strength and a permeability, and it is exactly the material a landslide
  model wants. `NOT_ICE` is checked FIRST so "Ice-contact glaciofluvial sand"
  — a sand, deposited by ice — is not filed as an ice sheet, and the word
  boundary keeps `Iceland` and `pumice` out on its own.
- **`featureFilter` is a tiler option, not a panel one.** Filtering after the
  fact would leave the ice in every extraction the layer answers.

### The card folds, and an open fold needs the room

Sixteen property rows, fourteen citations and twenty attributes do not go
under a title. The card carries `<details class="scene-popup-fold">` sections
— Rock properties, Sources, Attributes, Also under this point — built by one
`fold(title, fill)` helper on both card paths, so the geology sheet and a
rock-property layer answer in the same card.

**The height cap had to become a fold-aware one.** The card is capped at 17%
of the canvas so a readout cannot cover the map it describes, and a sixteen-row
table inside 145px is a scrollbar with three lines showing. A `toggle`
listener raises the SCROLLER's inline `max-height` to 50% while any fold is
open and restores the cap when the last one shuts — measured 145px closed,
428px open, 145px again after, with the card still inside the window. Inline
from JS rather than in a stylesheet because `styles.css` reaches Earth alone
and this card is on all ten worlds.

**`renderer` is not visible from `openGeoPopup`.** Reading
`renderer.domElement` for the canvas height threw "renderer is not defined",
which aborted the rest of the function — and the card then shows whatever the
LAST click left in it, which reads as stale data rather than as a crash. This
file already records the same trap with `elevationSampler` in the same
function. The canvas is looked up in the DOM.

**And the folds walked the card straight into the `.gis-tool-body` fault.**
`.scene-popup-detail` is `display: grid` with no columns declared, so its
implicit column is `auto` — max-content, refusing to shrink — and one long
property row laid the box out at **471px inside a 320px card**, with every
value cut off at the edge. `grid-template-columns: minmax(0, 1fr)`, the fix
that rule's neighbour already carried. Then the ROW's own
`max-content 1fr` did it one level down: "Geological Strength Index (typical
field range) (-)" took 259 of 271px and squeezed its value to nothing, so the
key column is `fit-content(9.5rem)` — natural width for a short caption,
wrapped at the cap for a long one — with `overflow-wrap: anywhere` on the
value, since "[1.0e-11–1.0e-6]" is one unbreakable word to the line breaker.
Measured after: **0 of 17 rows overflowing**, detail box 271px of 271.

**The world geology card had no Attributes at all**, because the geology
panel's feature builder never set `feature.rows` — the fold existed and had
nothing to fill it. A card that reads a property off the feature is only as
good as what the builder put there.

### The card says a thing once, and a citation is not a fact about the rock

The folds arrived and the flat list above them was not re-read. Three rows had
to go:

- **CLASSIFICATION repeated the KICKER.** "Sedimentary — Continental" is the
  line above the title and was also the first detail row three lines under it.
  The duplicate guard that already runs here compares the title against the
  META parts and never looked at the detail list.
- **BASIS is the one interpretation on this card**, so it leads **Attributes**,
  above the survey's own columns — ours first, then theirs.
- **ORIGIN is a citation**, so it leads **Sources**, above the property
  citations: the map is the first source, and the rest are sources for the
  second question. The fold is built outside the properties branch now, since
  a unit whose lithology the database cannot name still has a survey that
  mapped it — and the async citation list writes into its OWN node rather than
  into `host`, or the first `host.textContent = ""` erases the origin line.

The ticket that guards an answer arriving in the wrong card was hoisted with
it: one `pass` per card open, shared by every async fold.

Measured after: flat list `["Area 8,942.4 km²"]`, Sources leading with
"Macrostrat Burwell compilation, CC BY 4.0…" then 14 property citations,
Attributes leading with Basis then `Map id 3136440`, and the kicker still the
only place the classification is stated.

### A `lith` string is a DATA FORMAT, and the card was printing it raw

The heading read `Major:{claystone}, Minor{siltstone,sandstone,gypsum}` —
the compilation's own proportion syntax, braces and colons included. Measured
on one view of the world layer: **203 of 299 distinct `lith` strings are in
that form**, so this is the normal case rather than an oddity, and both cards
wore it.

`gis/lithology-label.js` is the display formatter — `Claystone — minor
siltstone, sandstone, gypsum` — used by the viewer's card and by
`feature-popup`'s, so a clipped or derived layer reads the same as the sheet.

- **Display only.** `rock-properties.js` gets the string VERBATIM: those
  proportion words are what weight a mixture, and a prettified string is a
  second spelling for its parser to learn.
- **The proportion word is kept**, not dropped. "Minor" is the difference
  between a claystone and a claystone with gypsum in it, and both a landslide
  and an aquifer care which.
- **Splitting on the comma and rejoining with ", " is IDENTITY** for the terms
  that carry their own comma — "carbonates, consolidated", "gypsum, anhydrite"
  — so a display split cannot damage them, which is why this needs none of the
  dictionary machinery `resolveLithology` has.
- **A rock is named once, at its strongest mention.**
  `Minor{limestone,siltstone,limestone}` is live data, and a heading that says
  limestone twice reads as a fault in the map.

Tested against strings pulled off the live tiles, the rock-class rule.

### A card opens at its own top, and SCROLL ANCHORING undoes one `scrollTop = 0`

The scroller is reused for every click, so a card opened after one that had
been scrolled down came up mid-way through itself — heading, classification
and name above the fold line — which reads as a card with no title.

Zeroing it once is not enough and the reason is the browser helping: Chrome's
**scroll anchoring** keeps the reader's place when content above the viewport
changes size, and the property fold fills in asynchronously. Measured, a fresh
card set to `scrollTop = 0` came back at **124** with its heading off the top.
So `overflow-anchor: none` on that element, and the top is retaken on the next
frame and again at 300 ms — both guarded by the card's own ticket and
abandoned the moment a fold is open, which is the reader taking over.
## The ice layer was a geological map's idea of ice; the world has an inventory

"The ice cover polygons poorly cover the world's glaciers — Eyja and Katla are
unaccounted for", with a screenshot of Iceland. Both true, and neither is a
fault in Macrostrat: a geological compilation maps ice the way it maps a rock
unit, so its ice is a few coarse blobs and the small ice caps are simply not
in it.

**The Randolph Glacier Inventory 7.0 is the map of ice** — one outline per ice
mass around the year 2000, the reference product, CC BY 4.0 — and it is baked
into this site as vector tiles by `services/bake-glaciers.py`:
**192,869 glacier complexes over 706,744 km², 881 tiles, 98 MB, zoom 0-6**. The
total is RGI's own published figure to a fraction of a percent, which is the
check that no region was silently lost.

Four things there are decisions, and each is a wrong map if reversed:

- **Complexes (`C`), not glaciers (`G`).** `G` splits an ice mass into flow
  units by ice divide — 274,000 of them — and this layer answers "where is
  there ice", so a contiguous ice cap should be one polygon and not eleven
  wedges meeting at a dome.
- **RGI DOES NOT MAP THE TWO ICE SHEETS**, which are about 96% of the ice on
  Earth: it maps the glaciers and ice caps AROUND them. They come from Natural
  Earth 10m, by NAME rather than by a bounding box (a box round Greenland also
  catches its peripheral ice caps, which RGI maps properly and which would then
  be drawn twice).
- **The ice sheets are a FILE, not tiles.** Web Mercator stops at 85.05°, so a
  tiled Antarctic ice sheet is a ring of ice around a hole exactly where the
  subject is. `data/global/ice-sheets.geojson` reaches 90°S.
- **AND THE SHELVES, which were missing from the first version.** Asked "is
  this all the ice", the honest answer was no: `ne_10m_glaciated_areas` is the
  GROUNDED sheet, and Ross, Filchner-Ronne and Amery all returned nothing when
  probed — about **1,555,136 km² of floating ice** absent from a layer called
  ice cover. They ship in the same file under `kind: "Ice shelf"`, coloured
  apart, because a shelf is the sheet's outflow afloat on the sea and already
  displacing its own weight of water: a shelf collapse and an ice-sheet loss
  mean different things for sea level. Totals now: Antarctica 12,059,468 km²
  grounded, Greenland 1,746,539, shelves 1,555,136.
- **Neither `-simplify` nor `RFC7946=YES` may touch that file.** Simplifying
  the thin shelves at 0.002° turned one into a LINESTRING and two into features
  with no geometry, in a source with no lines in it; RFC7946 re-split
  antimeridian geometry Natural Earth had already split and EMPTIED half of the
  Ross Ice Shelf — the largest shelf on Earth, half of it a valid feature with
  nothing to draw — while changing nothing at all on the ice sheets (measured
  identical either way). Both are the same shape of fault: a degenerate result
  that still passes for a feature.
- **Tiles rather than one file, for the reason the geology already records.**
  192,869 polygons is twenty times the geology sheet's triangulation budget and
  tens of megabytes; a cut by size (complexes ≥ 2 km² are 11,467 of 192,869 and
  carry 93.7% of the area) is an overview pretending to be an inventory.

**A point-in-polygon loop's `j` is the PREVIOUS index.** Written
`j = i += 1` — which assigns the incremented value — every edge is tested
against itself and every point is outside every polygon. In the shelf check
that read as five named ice shelves missing from a file that plainly contained
them. `j = i, i += 1`.

Measured live over Iceland after: **375 features drawn**, and every ice cap the
report named is there with its published area — Eyjafjallajökull 80 km²,
Mýrdalsjökull 597, Vatnajökull 8,087, Hofsjökull 889, Langjökull 921,
Drangajökull 146, Snæfellsjökull 12.

### The tiling scheme was in this file, and it was wrong

`bake-glaciers.py` baked its first pyramid on **EPSG:4326, two tiles across at
zoom 0**, because the Macrostrat section above said so. `tilesForBounds` in
`mvt.js` is the truth and it is the ordinary slippy-map formula —
`x = (lon + 180) / 360 * 2^z` with a Mercator `y`, ONE tile at zoom 0. The 2×1
note belongs to GIBS, which really is 4326.

Nothing failed. Every tile decoded, every polygon was valid, the manifest was
consistent, and an Icelandic complex (`o1region` 06) came out at **142°E,
78°N** — the Laptev Sea. **A wrong tiling scheme is not an error, it is a
translation**, and the only thing that catches it is decoding a baked tile and
asking where it landed. That check is in `ice-cover.test.mjs` now, along with
the assertion that the bake states no scheme at all and takes GDAL's Mercator
default. The offending line in this file has been corrected in place.

### GLIMS is the archive; RGI is the answer to "where is there ice"

The pre-staged GLIMS packages sit behind an Earthdata login, which a page
cannot answer — but **`www.glims.org/geoserver` is a public WFS with
`Access-Control-Allow-Origin: *`**, so the archive is reachable live with no
credentials at all: `GLIMS:GLIMS_Glacier_Outlines`, GeoJSON, bbox. Measured, an
Iceland box returns 675 outlines in 3 seconds.

**It is MULTI-TEMPORAL, and that is what stops it being the cover layer.** One
glacier carries as many outlines as it has been mapped times — measured over
Iceland, 675 outlines for 608 glaciers, one of them six times — so drawn raw it
is the same ice counted six times, at whatever dates different analysts worked.
RGI is that database curated into one outline per ice mass, which is precisely
the layer a cover map needs. So the connector keeps **one outline per
`glac_id`, the latest `src_date`, `line_type = glac_bound` only** (the archive
also carries internal rock, basins and snowlines, which are not the glacier's
edge), and it REFUSES a pull with no study area — without one it would not
fetch "the world", it would fetch the first 4,000 outlines the server happened
to return. Verified live: 62 outlines over a drawn box, 62 distinct glaciers,
dates 1999–2003, the endpoint recorded in the layer's provenance.

### `drawnBbox` spoke a different bbox vocabulary from every connector

Found while wiring GLIMS, and it was breaking every live catalogue row that
takes a study area. `global-data.js` built `[west, south, east, north]`; every
url builder in `connectors.js` reads `bbox.minLon` / `minLat` / `maxLon` /
`maxLat`. So `[…].minLon` was `undefined`: the BGS builder joined four
undefineds into `",,,"`, the USGS one set four empty parameters, and the
services answered as though no box had been given — a study area silently
ignored, with the layer arriving looking plausible. Fixed at the ONE place that
builds the box, not in each reader, and pinned in `ice-cover.test.mjs`.
This file already records the same shape from the other side (`drape()` taking
`{minX…}` against `{west…}`); it is worth stating as a rule: **when two modules
describe a box, one of them must own the vocabulary and the other must be
tested against it.**

### An ice polygon opens the same card, saying ice things

The ice layers were already clickable — they are ordinary layers — and the card
said the wrong things about them, because every line it knows how to write was
written for a rock. Measured on the Ross Ice Shelf: kicker **"Continental"**,
which is `crustalSetting` answering about a polygon afloat on 500 m of
seawater; title "Ice"; no source, no date, and nothing anywhere saying whether
the ice was grounded or floating.

`gis/ice-card.js` writes those three lines, and **both card paths use it** —
the tiled RGI inventory builds its features in `geology-panel.js`, while the
ice sheets, the shelves and the live GLIMS outlines are ordinary imports built
in `feature-popup.js`. One implementation, so a glacier reads the same however
it arrived.

- **`feature.ice` is what stops the card re-deriving its own heading.**
  `rockClass("ice")` is honestly null, but `crustalSetting` still answers from
  the ELEVATION, so the classification was overwriting a heading the builder
  had already written. A feature carrying the flag keeps its kicker and title.
- **An unnamed glacier is not a nameless one.** RGI names about a tenth of its
  complexes and GLIMS about a fifteenth of its outlines, so an unnamed one is
  titled by WHERE it is — "Glacier complex, Iceland" — with its id on the meta
  line. "Unnamed" says nothing and reads like a fault in the data.
- **Grounded or floating leads the card** for the ice sheets and shelves,
  because it is the difference that decides what a loss means for sea level.
- **The published area sits beside the measured one**, and they disagree on
  purpose: 8,087 km² is RGI's own figure for Vatnajökull, 3,379 km² is the
  piece this card measured — the polygon as the tiles drew it, cut where a tile
  edge crossed the ice. Showing only ours would be restating the source at our
  precision.
- **`lithology: "ice"` is set deliberately**, not left to fall through: it is
  what the property fold looks the material up by, and ice has a real entry in
  that database — 900 kg/m³, porosity 2%, and the rest.

Verified live on all three sources: an RGI complex over Vatnajökull, the Ross
Ice Shelf, and a GLIMS outline over Mýrdalsjökull ("Glacier outline — GLIMS
archive", `G341024E63606N · imagery 1999-09-09`, published 145 km² against 147
measured).

**A drawn study area swallows canvas clicks.** Two ice clicks did nothing at
all while a study box was on the globe, which reads exactly like a layer that
is not interactive; clearing the area made the same click open the card. Worth
knowing before diagnosing a picker.

### "Not tight to the surface, and slow" — one cause, in the bake

Two reports in one line, and both were the same thing: **the coarse levels
carried every glacier on Earth.**

Baked with all 192,869 complexes at every zoom, a zoom-2 tile held tens of
thousands of polygons quantised to 0.022° — about **2.4 km** — and the layer
fetches the world backdrop before the view's own tiles. Measured on a tick over
Iceland: **33 seconds in, the 15 world tiles were still arriving and the view's
tiles had not been requested at all**, so what was on screen for half a minute
was ice generalised to kilometres. That is exactly "not tight to the surface,
view offset" — and the latency was the same fact.

**A polygon smaller than a pixel is not detail, it is bytes.** At zoom 2 a
pixel is about 20 km of ground at 65°N, where most of this ice is, so nothing
under 200 km² can be drawn there at all. The bake now cuts by level, and the
numbers say the coarse levels lose nothing that could have been seen:

| levels | smallest complex | complexes | share of the world's glacier area |
| --- | --- | --- | --- |
| z0–2 | 200 km² | 323 | **75.7%** |
| z3–4 | 20 km² | 1,638 | 86.4% |
| z5 | 5 km² | 4,978 | 90.9% |
| z6 | everything | 192,869 | 100% |

GDAL bakes a zoom RANGE per run and has no per-zoom filter, so these are four
runs merged into one tree — they cannot collide, each owns its own zoom
directories.

**And the world backdrop no longer blocks the view.** For a layer off its own
pyramid the pin is fired in the BACKGROUND: the far side still fills in, and a
reader looking at Iceland waits for Iceland.

Measured, tick to ice on screen: **33 s → 6.1 s (the lighter bake) → 1.2 s (the
background pin)**, with the view's zoom-6 tiles now requested at 35 ms rather
than after the whole world. The pyramid also came down from 98 MB to **65 MB**,
of which the whole world backdrop (z0–2) is **1.4 MB**.

**And the deepest level is placed on a finer grid.** An MVT tile quantises
every vertex onto its own grid — 4096 units across by convention — which at
zoom 6 is about 65 m at 65°N, so below roughly 100 m per pixel the outline
showed the grid as a staircase. `EXTENT=8192` halves the step for **17 MB**
(z6: 43 → 60, pyramid 65 → 82 MB), where a whole extra zoom level would have
cost 28 MB for the largest 1,638 complexes alone and left every other glacier
stepped. `mvt.js` reads each layer's own extent, so nothing else changed.
Measured on Mýrdalsjökull: **6,238 vertices at a 34 m median edge** against
2,408 at 93 m, with the bbox still matching RGI's own to 1e-4°.

The remaining limit is the honest one: RGI's outlines are digitised from
15–30 m imagery, and the GLIMS row fetches those natively for a study area.

### A re-bake is invisible to a browser that already has the tiles

`?v=` versions the MODULES. A tile is an ordinary file at an ordinary URL, so
after re-baking zoom 6 on a finer grid the page went on drawing the coarse
tiles it already held — measured, 2,647-vertex outlines from cache while the
disk held 6,238-vertex ones. A bake that appears to have done nothing.

Two files needed busting, and fixing only the first does nothing: the
**manifest** carries a `version` fingerprint (`<tiles>-<bytes>`) that
`vector-tiles.js` appends to every LOCAL tile request — and the manifest is
itself a file, so it is fetched with the module stamp. Without that second
half the browser keeps the old manifest, never learns the new version, and
serves the old tiles from cache. The remote never gets the parameter: that is
somebody else's cache key.

**And "blocky" was the screenshot, not the map.** The staircase in a
downscaled 800 px capture of a 1,394 px canvas is the capture's own aliasing on
a high-contrast white shape. Measured on the drawn outline: **vertices 0.8 px
apart (median) on a shape spanning 549 × 637 px** — sub-pixel, which is as
smooth as the screen can show. When a rendered edge looks stepped, project the
geometry and measure the vertex spacing in PIXELS before believing the picture.

### The glaciers' own names, and why an outlet's name is not the ice cap's

"Surely we can find the real names of the glacier complexes?" — yes, and the
whole job is deciding which name is honestly the name of THIS ice mass. RGI's
complexes carry no name column at all: a complex is an id, a region and an
area, which is why the biggest ice cap in Europe read "Glacier complex,
Iceland".

`services/name-glaciers.py` writes `data/global/ice/names.json` — **38,016 of
192,869 complexes named (19.7%)**, 1.25 MB — under three rules applied in
order, each stricter than the next:

1. **RGI's own, where the complex IS a glacier.** RGI names 57,996 of its
   274,531 glaciers and every region ships a `CtoG_links.json` saying which
   glaciers make up each complex. One glacier → that name (35,017). Many
   glaciers all carrying ONE name over more than 80% of the area → the same
   (2,202).
2. **A gazetteer ICE CAP inside it.** GeoNames files an ice cap as `H.CAPG` —
   **61 in the world** — and where one falls inside a complex that is the ice
   mass's own name.
3. **A single gazetteer glacier inside it** (`H.GLCR`, 8,291 points), and only
   where exactly one falls inside.

**Rule 2 exists because rule 1 gets the big ones wrong.** Vatnajökull is 99
glaciers in RGI and nine of them are named — Skeiðarárjökull, Brúarjökull, and
so on, every one an OUTLET. Taking the largest named glacier would have called
the whole ice cap Skeiðarárjökull, and Mýrdalsjökull would have been
Öldufellsjökull: a plausible name, on the wrong feature, which is the hardest
kind of wrong to notice. The rule that produced those was written and measured
before it was rejected.

- **The card says where the name came from**, because they are different
  claims: RGI's is that glacier's own name, the gazetteer's is a match by
  POSITION.
- **A sidecar, not a tile property.** A name is 20 bytes on a feature that
  already costs a kilobyte of geometry — and baking it in would mean re-baking
  an 82 MB pyramid for every correction.
- **Keys drop the `RGI2000-v7.0-C-` prefix**, which is 14 bytes on every one of
  forty thousand entries and says nothing.
- **The lookup is injected into `ice-card.js`**, which stays pure and testable
  in Node while the table is a 1.25 MB fetch the browser makes once.

Verified live: a click on the ice cap reads **"Glacier or ice cap /
Mýrdalsjökull / Iceland"**, published area 597 km² against 598.7 measured, with
"Name from: GeoNames (CC BY 4.0), matched by position" in its Attributes.
## Ice has a volume, and the archive has a memory

Two things the outlines could not answer: how much ice is in one, and what it
has done since.

### Volume, thickness and sea level — IceBoost, joined by identity

`services/bake-ice-thickness.py` writes `data/global/ice/thickness.json` from
**IceBoost v2.0** (Maffezzoli 2026, CC BY 4.0, doi:10.5281/zenodo.21220985) — a
deep-learning ensemble trained on the GlaThiDa measurements, published **per RGI
7.0 glacier COMPLEX**, which is the very key the tiles carry. So the join is by
IDENTITY, not by position: 192,869 rows against 192,869 complexes, and the
table's own area total is 706,744 km² — the inventory's, to the km².

Why not **Farinotti et al. (2019)**, the older consensus estimate: it is keyed
to RGI **6.0 glaciers**, so it would need a 6-to-7 link table AND a sum from
glaciers up to complexes, and it ships as about 100 GB of rasters. The
compiled IceBoost table is 26 MB.

The totals are the check on the join rather than statistics for their own sake:
**149,318 km³ of ice** against Farinotti's ~158,000 from a different method, and
**343 mm of sea-level equivalent** against a published ~324 mm. Close enough to
believe the join; far enough apart that the card quotes the source.

- **The volume never appears without its uncertainty** — the model's own runs
  to tens of percent, and a bare number reads as a measurement. Verified live:
  Mýrdalsjökull 208 ± 39.8 km³, mean thickness 349 m, 0.52 mm of sea level;
  Vatnajökull 3,810 ± 565 km³ and 9.57 mm.
- **Mean thickness is DERIVED** from the volume and the published area rather
  than tabulated: it is the number a reader pictures, and deriving it keeps the
  file to what the model actually produces.
- **Sea level subtracts the ice already below it.** `vol_bsl` is carried for
  exactly that: ice below the waterline is already displacing its own volume.
- **Three significant figures**, because a fourth is noise the uncertainty does
  not support — and 0.4 MB of it across 192,869 rows.
- A sidecar again, for the same reason as the names: 5.5 MB that loads once
  beside an 82 MB pyramid nobody wants to re-bake when a model is revised.

### Change over time — the archive read as pairs

`glims-change` is the same WFS request as the outlines row, read differently:
group by `glac_id`, take the earliest and latest outline, report the area
change and its rate. Measured over the Valais Alps: **431 glaciers with repeat
outlines**, median **−0.3% a year**, and spans reaching back to **1850** —
GLIMS holds Little Ice Age maximum outlines, so Glacier de la Luette reads
−61.4% between 1850 and 2016.

Four rules, each because the naive version says something false:

- **Two readings of one summer are not a change.** A pair less than two years
  apart is dropped.
- **A glacier does not change by a fifth of itself in a year.** A handful of
  Alpine pairs came out at **+244 and +432% a year** — not growth, but two
  outlines of different things under one id, usually an early submission that
  digitised a single tributary. Past 20% a year they are dropped: a quantile
  legend that runs to +4,000% makes every real value one colour.
- **Only `glac_bound`**, or an internal rock outcrop becomes an outline.
- **The card says what it is NOT.** An area change is not a mass balance: a
  glacier can thin for a decade without its outline moving, and late-lying snow
  can make an outline larger than the ice under it. Both dates, both areas and
  the span are on the card so the reader can weigh it.

The geometry drawn is the LATEST outline, so the map shows the ice as it was
most recently mapped, and the colour is a DIVERGING quantile ramp because zero
means something here — a sequential one would hide the sign.

### The card's own face: what it says, and how much of it fits

Three reports on one card, and the third was not what it looked like.

- **"Repeat outlines" is how the layer is MADE, not what the card is about.**
  The kicker reads "Glacier — change over time" now. It is deliberately NOT
  "vol. change", which was the wording asked for: two outlines give an AREA,
  and volume through time is not in this data — IceBoost is a single epoch — so
  that kicker would claim a measurement the card cannot show.
- **The id and the outline count came off the second line.** `G007581E46002N ·
  13 outlines in the archive` is plumbing where the card's meta line should be
  saying something about the ice; both moved into the rows.
- **"The change measurement doesn't supply dates or rate of change" — it did,
  one line below the cut.** The card is capped at 17% of the canvas, which is
  two rows, and these cards lead with three or four: area change, rate, and the
  dates between; or volume, mean thickness and sea-level equivalent. The closed
  cap is now the height of everything ABOVE the first fold, floored at the old
  17% and ceilinged at 32% — measured on the change card, 145 → 225 px, with
  all four lines on the face and the folds still below.

**And the fit has to be measured after the card is SHOWN.** That block runs
while the card is still `hidden`, and a hidden element has no layout:
`offsetTop` is 0, so "the height above the first fold" came out as nothing and
the cap silently fell back to its floor every time. Taken again on the next
frame, after `hidden = false`.

**A centroid is not inside a valley glacier.** Verifying the click cost a
detour: the mean of Zmuttgletscher's vertices lands outside the glacier, so
clicking "the middle" of a crescent picked nothing and read as a broken picker.
Ask the app's own `featuresAt` for a point it accepts before driving a click at
it.

### Change over time is a FETCH, so it gets a subtab, not a tick

The glacier-change layer shipped as a catalogue row, and a tick is the wrong
control for it: what it costs and what it covers both depend on the box.
Measured over one 1.2° × 0.9° box in the Valais Alps, GLIMS holds **15,568
outlines** — so a tick is either a download nobody asked for, or it silently
uses whatever shape happens to be on the globe and answers a question the
reader never put.

It is a subtab now, built like the GFS card and out of the same parts: the
extent select (`refreshPolygonOptions(..., { allLayers: true })`, so every
drawn shape and every loaded layer is offerable), the two-press Draw button
that CLAIMS the shape as a real layer, a Fetch, and a status line that says
what came back. Verified live: "846 glaciers with repeat outlines, median
−0.30% a year, spanning 1850–2018."

Two seams this needed, both small and both general:

- **`addDataset` takes an explicit bbox.** It read `drawnBbox()` — right for a
  catalogue tick, and it threw away the answer of a panel that had just asked
  the extent picker. The caller's ground first, the drawn overlay second.
- **A dataset may be `hidden` from every list and still loadable by id.**
  `grouped()` filters it out; `datasetById` still finds it. Without that the
  entry either kept its catalogue row — two doors to one layer — or lost its
  home and fell into the general vectors list, which is worse.

**A WINDOW OF TIME, applied on the SERVER.** The archive runs from the Little
Ice Age maxima to last year, so "when" is half the question — and GLIMS's
GeoServer takes CQL, which turns the window into a smaller fetch rather than a
bigger filter: measured on the Valais box, **15,568 outlines unfiltered against
12,000 for 1990–2020**. Two things that server is particular about, both found
by measuring rather than reading: `bbox` and `cql_filter` are **mutually
exclusive** (HTTP 500, "both specified but are mutually exclusive"), so the box
goes INSIDE the filter; and `BBOX()` there takes **lat, lon** — the WFS 2.0
axis order for EPSG:4326 — where lon,lat returns a confident **zero features**.
The window is applied again on the way in, so an outline outside it can never
become an endpoint if the server filter is ever dropped.

**AND THE EXTENT LIST OFFERS EVERY GROUND THE APP KNOWS**, the weather card's
arrangement: an area drawn by hand, typed bounds, and every layer on the globe
— imported shapefile or shipped catalogue — appended by
`refreshPolygonOptions(..., { allLayers: true })`. The base options are in the
MARKUP because that function appends and adds none of its own; the select
shipped empty for exactly that reason, which the GEE extent select already
records paying for.

**AND THE CAP IS REPORTED.** GeoServer says how many it had: measured, 15,568
matched against 8,000 returned. A quarter of an archive drawn as though it were
all of it is a map answering a different question, so the shortfall rides on
every feature and both the card and the status line say it — "This fetch held
8,000 of 15,568 outlines in this area — draw a smaller one to see the rest."
## The time-lapse: the archive's own dates, played

A change map answers "how much" in one number per glacier. Somebody looking at
a retreating tongue wants to SEE it, and the archive already holds what that
needs — every outline anybody submitted, each stamped with the date of the
image it was drawn from. `gis/glacier-timelapse.js` plays them in order with
imagery from the same date underneath, on a bar over the map: play, step, a
slider, the date, and what is being drawn.

Every part of it is something this app already had: `glims-outlines` with
`all: true` (which keeps the older outlines the change layer deliberately
drops), `renderFeatureCollection` for each epoch's geometry, `gee.js`'s
`drape` for the picture, and the Draw HUD's own furniture for the bar.

**Imagery, in the order of what is actually there** — and the bar always says
which of the three it is drawing:

- **Earth Engine** where the service will answer. Sentinel-2 at 10 m from 2015;
  Landsat back to 1984 the moment the function is redeployed. Measured today,
  the deployed one answers `Unknown or unsupported dataset` for **every**
  Landsat id — the allowlist shortfall this file already records — so the
  fallback is not theoretical.
- **GIBS** otherwise: MODIS true colour from 2000-02-24, VIIRS from 2012, at
  250 m, keyless and CORS-open. Checked against GIBS's own capabilities: there
  is no Landsat or Sentinel true-colour mosaic in it, so 250 m is the ceiling —
  context at ice-cap scale, and honestly not an outline.
- **Nothing before 2000**, where the outlines play on the basemap alone.

`fetchScene` was added to `gee.js` for this: `request()` is the Atmosphere
card's whole flow — read the form, fetch, drape, register a layer, keep the
ground — and a caller that wants a PICTURE and will place it itself needs the
middle of that and none of the rest. Every scene is a billed request, so
nothing is fetched until the bar reaches it and every frame is cached.

Three faults on the way, and two of them are this file's oldest lessons:

- **A FOURTH BOX VOCABULARY.** `basemap-drape` speaks
  `{minLat, maxLat, minLon, maxLon}`; the extent picker speaks
  `{west, south, east, north}`; `gee.drape` speaks `{minX, minY, maxX, maxY}`.
  Handed the wrong one, nothing throws: `lonToPixelX(undefined)` is NaN,
  `chooseZoom` falls to 0, every tile URL carries `NaN`, and the composite
  reports **"no tiles for this area"** — which reads as a service with no
  coverage rather than a mismatched shape.
- **A drape that is not a LAYER keeps renderOrder 6.** `drape()` hands back a
  mesh in the viewer's basemap shell band because the GEE path registers it and
  lets `applyStack` stamp the band on afterwards. A frame of a sequence is not
  a layer, so it kept 6 and drew *under* the streamed imagery patch at 40:
  measured, on the globe, visible, and invisible. 45 — above that patch, below
  the imported band the outlines are in.
- **The epoch cap is reported**, like every other cap here: the fullest dates
  win and the count of dropped ones comes back with the sequence.

Verified live over Iceland's south coast, 1999–2020: **6 dates, 72 outlines**,
playing 1999-09-09 (31 outlines, no imagery that far back) → 2000-08-28 (14,
MODIS Terra) → 2003-07-16 (12, MODIS Terra), each frame's picture arriving with
its own date and its credit burnt into the texture.

### Four reports on the time-lapse, and the flicker was three things

**"Are we definitely fetching from GEE?"** Now yes, and proven: a Valais epoch
reads *"8 outlines · Sentinel-2, 10 m · 2018-05-01–2018-10-31 · Earth Engine"*.
It was not before, and the reason was the WINDOW, not the wiring: a plus-or-
minus 45 day window round the outline's date returned "no imagery" from the
service — one satellite over one glacier in six weeks is mostly cloud — while
the same box over that summer returned a picture. The window is the MELT SEASON
of that year now, and it follows the hemisphere: May–October north, November–
April south, or a southern season composites the middle of its winter.

**The imagery source is a dropdown**, not just a fallback chain: Best
available / Earth Engine / NASA GIBS / None. A reader comparing two epochs may
want the SAME instrument in both even where a better one exists for one of
them — a change that is really a change of sensor is the easiest false reading
a time-lapse can produce.

**The credit banner is off the picture.** `composite()` burns it into the
texture, which is right for a drape somebody keeps and wrong for a frame of a
sequence: a caption stamped across the ground, changing every second. The
condition is still met — the bar names the instrument, the dates and NASA
EOSDIS GIBS, in text a reader can actually read.

**The flicker was three faults, not one:**

- **The old frame came down before the new one went up.** Every step went
  imagery → bare basemap → imagery. Nothing is hidden now until its
  replacement is in hand, which reads as a dissolve rather than a blink.
- **Nothing was prefetched.** The next epoch's scene is fetched while the
  current one is being looked at, and PLAY waits for it — up to four seconds,
  after which it moves on, because a source that will not answer must not stop
  the sequence.
- **"Partial polygons" was the archive, not the renderer.** Each epoch holds
  only the glaciers somebody mapped that day — 31 outlines on one date here, 12
  on the next — so stepping made whole glaciers appear and vanish. A GHOST of
  every glacier in the box (the union, thin outlines, never hidden) is the
  continuity: what moves between frames is then genuinely the ice that was
  remapped.

### Half of Katla: a glacier is every PIECE of its outline, not its last row

"Not all glacier extents animate — only half of Katla (Mýrdalsjökull) is
mapped." GLIMS files a boundary as ROWS, one polygon each, under one
`glac_id`: an ice cap digitised in parts (two scenes, two analysts, often two
imagery dates) is several rows. Every reader here kept ONE row per id — the
time-lapse's `stateAsOf` (`held.set(id, feature)`), the ghost (first seen),
the outlines row (latest), the change layer (latest as geometry, first and
last rows as the "change") — so whichever half was filed last WAS the glacier,
in every frame after it, and two halves read as the ice cap doubling.

`gis/glacier-outlines.js` is the one rule: a newer outline SUPERSEDES the held
pieces it overlaps (a remapping, retreat or advance — tested by an interior
grid sample, ≥30% of either lying on the other) and leaves the pieces it does
not touch (two halves share only the divide, so vertices would not do). A
glacier's pieces are merged into one MultiPolygon feature per frame, its
change is measured against the outlines those pieces DESCEND from (so halves
filed on two dates are one mapping, grey on the change map), and areas are the
polygon's own (`db_area` belongs to the analysis and repeats per row). With no
polygon (points, test fixtures) the id decides, as before. Used by
`stateAsOf`, `ghostFeatures`, `firstAreas`, and both GLIMS converters.

The renderer had the other half of the symptom: `fillTriangles` refuses a hole
not inside its contour (right — it would bridge), and that ring was then never
drawn. `regroupRings` in `vector-render.js` regroups a GeoJSON polygon's rings
by containment first (mvt.js's rule), with a fast path that returns a
well-formed polygon untouched. Pinned in `glacier-outlines.test.mjs`.

Not verified against live GLIMS: www.glims.org is unreachable from the dev
sandbox (proxy 403), so the Katla rows themselves were not inspected; the RGI
tiles (`data/global/ice/*`) are not on disk either (`tiles_base` is the bucket,
which the ice-cover test's "every tile is on disk" check predates) — that
failure is unrelated to the GLIMS time-lapse, which never reads the tiles.

### The bar's ◇ and ✕ are icons, and a short bar stacks its track

The bar's width is the sidebar's arithmetic (`100vw − 52rem`, 608 px at a
1440 window) while the row needed ~790 px — so the overlay toggle and the
close ran off the pill's right edge (measured 1129–1205 against a bar ending
at 1024). They are `tl-icon` squares (1.55rem, the pill's border and fill,
`aria-label` beside the title, as every transport button now has), and
`balanceRow` measures the lead, the trail and a 12rem track floor against the
bar's inner width: past it the bar takes `is-stacked` — transport and
count-and-close on one line (the note ellipsises, its full text on the title),
the track on its own full-width line under them. Re-measured on resize and
whenever the note grows. Measured at 1920/1440/1100/390: every button inside
the pill, `scrollWidth` ≤ `clientWidth`.
## "New" is a difference between two bakes, so the bake has to record it

The Earth Engine catalogue is baked because the STAC tree cannot be walked in a
page. A snapshot then goes stale silently — and worse, **a snapshot cannot be
asked what changed**, so "what has Google added?" has no answer at all from the
file the panel reads. It has to be recorded at the moment it can still be
computed, which is the bake.

`bake-gee-catalogue.py` reads the PREVIOUS `gee-catalogue.json` and stamps two
dates on every entry: `firstSeen` (the bake it first appeared in) and, where a
collection's temporal extent has moved forward, `extended`. That second one is
the honest reading of "new imagery" for something still being flown. Measured
over one six-day gap: **3 datasets added and 177 collections extended**, with
Sentinel-2 advancing 2026-08-28 → 2026-09-01 and Sentinel-1, ERA5-Land and the
Copernicus Marine set alongside it.

**Both are read by EQUALITY against the payload's own `baked`**, never against
today. An index nobody has re-baked for six months then goes on naming the same
handful rather than quietly promoting older datasets as the clock runs.

**THE FIRST BAKE MARKS NOTHING NEW.** With no previous file every id is unknown
and every one would be stamped today — eleven hundred badges, which is
`atlas-watch`'s first rule in a new costume. That run sets `baseline: true` and
the page treats the whole file as already seen. A previous file *without* the
field is a different case and is not a baseline: its ids are known to have
existed by its own bake date, so they take that date and anything absent from
it is genuinely new. That distinction is what made the very first diff real
rather than empty.

### The cheap signal is the BUCKET LISTING, and four things about it were measured

Google publishes the STAC on Cloud Storage, and the JSON API lists a bucket a
thousand objects at a time — **2 requests against the 1,272 the tree costs**.
Both endpoints answer CORS (the object endpoint `*`, the listing endpoint by
reflecting the Origin), which is why no key and no proxy appears in
`gee-watch.js`. Each of these is a wrong answer if assumed:

- **`updated` is not a change signal.** Google rewrites most of the bucket at
  once — measured, **1,176 of 1,686 objects carried the same day**. Trusting it
  announces the whole catalogue as changed. Only the NAMES are read.
- **The listing is a SUPERSET of the tree**: 1,272 dataset objects against the
  index's 1,142, because an object can sit in the bucket without being linked
  from any provider catalog — **130 of them**, most last touched in 2023. So
  "in the bucket and not in our index" is NOT "new", and a diff against the
  index alone opens on 130 false alarms.
- **`-gfstmp-` objects are upload artefacts**, 236 of them, not datasets.
- **The id cannot be recovered from the path**, which the service already
  records from the other side. So the watcher compares PATHS and reports paths;
  it never invents an id it cannot prove.

### The third costume of the first rule, caught by its own test

`describeCheck` reported the count of bucket records the index lacks, framed as
how far behind the bake had fallen. It reads like the right measure and is not:
most of it is that unlinked residue, which does not change from one month to
the next, so the panel would have carried **the same sentence every session
forever** — a standing false alarm, which is what rule 1 exists to prevent. The
count is kept as a diagnostic and is deliberately absent from the sentence;
only a genuine publication speaks. The unit test failed on it before a browser
ever saw it, which is the argument for `triageCatalogue` being pure.

Verified live, all three legs, because a silent watcher and a broken one look
identical: a first run stored **1,272 paths and said nothing**; forgetting two
of them and reloading announced **exactly those two**; a third run was silent
again.

### Two faults the strip showed immediately

- **A control built from data that arrives LATER must be redrawn when it
  lands.** `renderGeeChips()` ran once, before the 136 KB index; `freshness()`
  had no catalogue to count and the New chip never appeared at all. The
  catalogue's `.then` redrew the list and not the chips. Same race the label
  colours lost to the symbology.
- **The filter and the badge must be ONE rule.** They were two for a few
  minutes, and under the New filter three offline-snapshot tiles stood in the
  list wearing no badge to say why — because the badge excluded a cached entry
  and the filter did not. Cached is the exclusion that matters:
  `requestFromCache` drapes a PNG that shipped with the site, and no imagery
  reaching Google's servers moves a file on disk. A tile in a filtered list
  that cannot say what it is doing there is the filter lying about its contents.

### The scheduled half does NOT commit

`.github/workflows/gee-catalogue.yml` re-bakes weekly and writes a job summary
naming what moved, with the baked file as an artefact. It takes `contents:
read` and pushes nothing, deliberately: pushing is this repo's one standing
rule, and a scheduled job that commits to `main` is exactly what that rule
exists to prevent. `--report-new` prints the last bake's news without fetching
anything, so the check describes the result rather than walking the catalogue
twice.
## The basemap list said everything twice, and one map was never ours to hand out

Four faults in one box, and only the first is about duplication.

**TWO CATALOGUES LISTED THE SAME SHIPPED ASSETS.** Every entry in
`map-layers.js` names a `manifest:` id — the same texture the base picker
offers — so GEBCO hillshade, GEBCO relief context and NASA's surface texture
each appeared twice in the Basemaps box, once under "Base texture" and once as
an overlay, under two spellings of one name. Not strictly duplicates in
function (the base is the sphere's own skin, the overlay is a draped sheet with
its own opacity and place in the stack) and unarguably two controls wearing one
name, which is the fault the Polygons tab's double ticks already record.

**The base picker won**, because the sphere must wear something and
`earth-viewer`, `layer-hierarchy` and `basemap-drape` all read
`#base-layer-select` unguarded — that control cannot be the one to lose. What
is left in the overlay catalogue is the one product with no base-texture twin:
GEBCO slope is in the manifest and is NOT among the select's options, so it is
reachable that way and no other. `map-layers.test.mjs` names the five ids that
would restore the duplication rather than counting entries.

**`distribute: false` is a SECOND AXIS on a tile source, and not the same as
`freeToStream`.** That one describes the LICENCE — whether a condition rides on
using the tiles at all. This one is the decision taken about that condition for
this deployment: Esri's World Imagery is the best-looking map on the list and
its item record puts it under the Master License Agreement, so it is fine to
work with locally and not something to hand to every visitor to a public page.
The source stays whole — registered, fetchable, credited, selectable in code —
and only `listBaseLayerOptions` withholds it. Deleting the entry instead would
take the implementation with it. Back for a session with `?basemaps=all`, or
durably with `localStorage["geoid-gis:private-basemaps"] = "1"`; the URL form is
deliberately not persisted, and a storage that throws answers NO, so the site
withholds rather than distributes. Verified both ways: 8 options without it, 10
with, Esri in neither the picker nor the list on an ordinary load.

**CartoDB's two were removed rather than hidden, because they were dead.**
Their free CDN answers 200 with an "API KEY REQUIRED" watermark instead of a
tile — already measured and recorded for `map2d.js`, which is why that map
opens on OpenStreetMap — so both offered a basemap that renders as a nag across
the planet.

**`blue-marble` is hidden from the LIST and kept in the SELECT.** It ships with
the site, so it paints the first frame before any network call and the globe is
never bare while a tile fetch runs; it is also `ensureNavigateBasemap`'s
fallback. It is not a map anybody chooses now that Sentinel-2 is the default,
and it cannot leave the element three modules read unguarded. `UNLISTED_BASE`
in `map-layers-panel.js` is that distinction written down.

**A "same as the default" constant has to change WITH the default.**
`DEFAULT_NAVIGATE_BASE_LAYER_ID` said `tiles-esri-satellite` with a comment
claiming it matched what the page opens on. It had not matched since the
opening default moved to Sentinel-2 over the licence — so it was quietly a
second, different default, and hiding Esri would have left it naming a service
the picker no longer offers.

**AND THE EARTH ENGINE GROUP LEFT THE BASEMAP LIST.** It merged in as its own
group on the reasoning that one list beats a second dropdown, which was right
about lists and wrong about this one: a row there is a TICK, and an Earth
Engine layer is a FETCH that needs an extent and a date range before it means
anything. The tick either sent a request nobody had specified or did nothing
anybody could see. The strip behind "+ GEE" has the controls the tick never
had. The seam is still consulted, so an id it owns is still routed correctly if
one reaches the list another way — only the offer is withdrawn.
## Time is a property of a fetch — `time-window.js` and `time-series.js`

The same three questions were asked in three vocabularies (`imagery-tl-from`,
`gee-date-from`, and the glacier animator asking none because its dates come out
of the archive), and the "run that fetch once per frame" loop was written twice.
`time-window.js` owns the QUESTION — read fields, validate them together, hand
back one window — and `time-series.js` owns the LOOP. What lies between them is
the source, and it is four fields: `cadences`, `epochsFor`, `costFor`,
`frameFor`.

**The glacier animator is the model, and three of its habits are why this is a
contract rather than a generic `map()`:** epochs come from the SOURCE (GLIMS
knows which dates it holds; an even split invents frames the archive cannot
fill), what a cap cost is RETURNED rather than swallowed, and nothing is fetched
until the timeline reaches it with the count known first — Earth Engine bills per
render, so the number of frames is consent rather than a progress bar.

**Four kinds of time, and one panel cannot serve them.** Earth Engine composites
a window (N frames = N billed renders); GFS answers every valid time of ONE run
from a single request; an events feed is a filter over features already in
memory (0 requests); a dated tile is a URL. `costFor` is what makes "96 frames,
1 request" and "12 frames, 12 billed renders" the same sentence over different
sources. Ask GFS for "one frame per year from 2016" and the question is
meaningless — which is why a source DECLARES its cadences rather than being told.

**A backwards range is REFUSED, not repaired.** The Earth Engine card silently
widens one by sixty days, which is reasonable for a card whose default IS a
sixty-day window and a bad rule to generalise: a time-lapse quietly given a range
nobody asked for is a sequence of the wrong years.

**The imagery driver calls the shared cap; the glacier animator deliberately does
not.** Striding rather than truncating is one implementation now. Capping by
keeping the FULLEST dates is a rule about the archive rather than about sliders,
and forcing it through an even stride would throw away the very frames it selects
for. A structural check pins both halves, so a third copy has to be a decision.

**The player is untouched and must stay so.** It has been the one player over
this globe for both drivers since before any of this; the argument order is
`onShow(index, epoch)`, checked against `state.onShow?.(index, epoch)` rather
than assumed — reversed, every source is handed an integer where it expects a
date.

### `earth-viewer.js`'s stamp is NOT the gis modules' stamp

Reading `q` off the earth-viewer script tag gives `?v=20260429-earth&t=<ms>`,
while every module under `gis/` carries the ordinary `?v=<sha>`. Import a gis
module under the viewer's stamp and it is a SECOND INSTANCE with its own
module-level state — so `stopPlayer()` from that copy sees `state === null`,
returns early, and the world clock stays hidden. Measured exactly that way and
reported to myself as an app bug for two rounds; against the correct stamp the
same sequence reads shown → hidden → shown with `playerIndex` 0 → −1.

The existing note says "read the stamp off a live script tag and import THAT".
Sharpened: read it off a **`gis/` script tag** (`mode-manager.js` is always
there). The stack trace in a thrown probe is what named it — the two URLs sat
one line apart in it, which no amount of reading the source would have shown.
## The estimate over time is a RASTER, and the static map stays a grid

"Should we change the probability map from the grid to geotiff for the
animation over time only, where it incrementally shows the change in
probability as new year's data is added?" Yes — for the animation, and only for
it. The two are different products answering different questions:

| | what it steps |
| --- | --- |
| `cyclone-timelapse.js` + the sparse sidecar | what HAPPENED that year — a count |
| `cyclone-risk-raster.js` + the COG | the ESTIMATE after that year — the climatology recomputed over 1980..Y |

**THE QUADTREE CANNOT BE ANIMATED, and that is the whole argument.** It
coarsens where the field is flat, and the field CHANGES every year — so a
quadtree rebuilt per frame changes its own GEOMETRY between frames, and half of
what a reader sees moving is the resolution rather than the hazard. That is the
glacier animation's fault exactly ("what moved between frames was which analyst
had been working"). A fixed lattice cannot have it: every frame is the same
1440x720 cells, so a difference between two frames IS a difference in the
estimate. The grid stays as the static map, where nothing is compared frame to
frame and its variable resolution is what makes it readable.

**And the raster is SMALLER than the thing it sits beside.** 47 global frames
as a Byte COG is **4.5 MB**, against 6 MB gzipped for the per-season JSON — the
field is smooth and mostly empty, and DEFLATE with a horizontal predictor eats
it (48.7 MB raw). A byte is 1/255 of the scale, far finer than six classes read
it at.

**One bake, three products.** The raster is derived from the per-year grids the
same pass already holds in memory, so there is no second copy of the stamping
to drift — the whole run is 121 s and stages nothing.

### The honesty rule this one needed

**A one-season estimate is not a hazard map.** One arrival in one year gives
P = 0.63 anywhere a storm passed; it is sampling noise wearing a probability's
clothes, and the 1980 frame looks like it — a handful of individual storm
corridors rather than a field. So every frame says how many seasons it stands
on and the thin ones say outright that they are mostly noise, the same rule the
pre-satellite track frames follow. Measured, the mean difference from the final
estimate falls **0.076 after one season to 0.0015 after forty-six**, which is
the sequence's actual subject: the map settling down.

### Four things it cost

- **`gee.drape` builds in the GLOBE's frame** and bakes that half-turn in
  itself, while `addDerivedLayer` reparents into `GeoID-ImportedGeoLayers`,
  which carries the spin a different way. Registering alone puts the sheet half
  a world from the ground it maps — so it is registered for its row and its key
  AND then `globe.add`ed, which is the pair gee.js does for the same reason.
- **The player parents nothing.** It toggles `node.visible` on `frames` and
  otherwise leaves the scene to the driver; every existing driver adds its own
  group through `addDerivedLayer`. A drape handed to `startPlayer` and never
  parented is built, textured, correct and invisible.
- **A REPAINT, not 47 drapes.** Every band is the same lattice over the same
  ground, so the geometry is built once and only the texture changes — 47
  global drapes would be some two hundred megabytes of texture for a sequence
  that shows one at a time.
- **`hotlink-ok` in the filename, or Cloudflare 403s it.** A `.tif` is an IMAGE
  to Hotlink Protection, which keys on the Referer — the soil thickness COG
  measured 200 from production and 403 from localhost, arriving in the browser
  as a bare `TypeError: Failed to fetch` with no status to read. Verified after
  publishing: 206 with ranges and CORS from both origins.

**The classes are the static map's own**, through the same `riskEdges()`, so
the animation and the map it animates cannot disagree about where a class
begins — and a value of zero is drawn TRANSPARENT rather than in the bottom
class, because ground no storm has ever reached is outside the map rather than
at the low end of it.
