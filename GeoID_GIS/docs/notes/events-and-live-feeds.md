# Events, live feeds, satellites, Earth Engine, weather, traffic

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

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
## A second door to a feed is not a second feed

The blanket feed proxies were removed from Hazards for putting one dataset in
two tabs, and the note explaining that is two sections up. One is back, on
request and with the duplication named: **Tropical cyclones ▸ Storms happening
now**, proxying `eonet-severeStorms`. What makes this one worth its duplication
rather than the general rule being wrong: the reader of a cyclone archive is
the likeliest person in the app to want what is on the ocean this morning, and
a row that only tells them to go to another tab is a trip rather than an
answer. It replaced exactly such a sentence.

**ONE STATE, TWO PLACES TO REACH IT.** `data-feed-toggle` on any box makes it a
proxy: it READS its state off `enabled` and COMMITS through `setSourceEnabled`,
so neither row can drift from the other. Measured through five presses,
alternating which row was driven: the proxy, the Live row and
`isSourceEnabled` agreed at every step, and the map followed — 5 storms → 0 in
4 s on an untick, 5 back in 6 s on a re-tick.

**NO POLL.** The old version ran a 900 ms interval hunting for boxes. Every
change of this state already runs through `renderFeeds`, so the sync is one
call at the TOP of it — above its early return, because a proxy lives outside
the feed panel's host and must follow the state on a world that has no feed
panel at all. That also covers the restore at boot, where a proxy would
otherwise open unticked over a feed that is already running.

**A live feed does not light a hazard subtab**, and it falls out of
`DATA_CONTROLS` naming specific selectors rather than "a ticked box". Severe
storms is on by default, so a proxy counted as data would leave Tropical
cyclones filled from boot for ever and the fill would stop meaning "a cyclone
dataset is on the globe" — the false positive the satellite category filters
were measured for. Pinned, because the next person to widen that selector list
would take it out silently.

### TWO TEST FILES, TWO `check` SIGNATURES — and one of them passes silently

The most expensive thing in this change, and it produced three green checks
over assertions that never ran.

| file | `check` | `ok` |
| --- | --- | --- |
| `cyclone-timelapse.test.mjs` | `check(name, fn)` — RUNS the callback | `ok(cond, msg)` |
| `event-sources.test.mjs` | `check(name, got, want)` — COMPARES values | `ok(name, got)` — **name first** |

Write the first file's idiom into the second and `check(name, () => {…})`
compares a FUNCTION against `undefined`; both stringify to `undefined`, they
are equal, and the check PASSES WITHOUT CALLING ITS BODY. Nothing warns.

Rewritten in the right idiom, one of the three failed immediately: the proxy
named **`severeStorms`** where the registry's id is **`eonet-severeStorms`** —
`eonet()` prefixes every category — so the markup and both test files were
wrong together. `syncFeedProxies` would have caught it in the browser too (it
disables a box naming an unknown source and says so on the title, rather than
drawing an honest empty tick over nothing) but the test caught it first, which
is the point of the test.

**Check the harness's own signatures before writing a check into a file you
have not written one in before.** A test that passes for the wrong reason is
worse than no test, and this tree already records the same shape twice — the
level-picking test that re-derived the behaviour it was checking, and the
flat-colour test that hid the thing it was testing for.

### And the verdict was duplicated rather than moved

`event-sources.test.mjs` had a summary at line 744 AND at 959, because the
earlier repair APPENDED a verdict at the foot instead of moving the one that
had been overtaken. The exit code was still correct — the trailing block
decided it — but a partial summary printed mid-run with **52 checks still to
go**, which is a number that will be believed by whoever reads it. Removed, and
the survivor is in `process.on("exit", …)`.

**The exit hook does set the exit code** — verified by A/B, a deliberate
failure appended after it exits 1. An earlier A/B appeared to show otherwise
and was itself the idiom bug above: the appended check passed spuriously, so it
never tested the hook at all. **When an A/B says a mechanism does not work,
check that the probe is exercising the mechanism.**
## Satellites are drawn at TRUE SIZE, camera-relative

Supersedes the "not to scale" model above. `halfSpanKm(record)` gives each
satellite its real half-span (category defaults; the ISS 54.5 m, Tiangong 27,
Hubble 6.6), the model is placed only within about a pixel of being visible
(`modelFarKm`, 2,000 half-spans), the flight lands at 8 half-spans (`landKm`:
436 m from the ISS), scrolling stops at 1.6 (`followMinKm`: 87 m), and the
follow lasts until the globe is dragged rather than 20 s — at 7.7 km/s an
expiring follow leaves a 30 m view empty in a frame.

**Camera-relative, or a 10 m object shimmers.** At 6,800 km from the centre
one float32 step is half a metre, so the model group sits AT THE CAMERA (in
the tracker's frame) and each instance is its offset from it; the large
translation cancels in double precision on the CPU. Verified headless: ISS
followed at 436 m, wheel to 87 m, models gone at 23,000 km.

### A drag turns the view round a followed satellite; it does not let go

"Once we move the cursor, it disappears": a press on the canvas ended the
follow, and a satellite let go of at 436 m leaves the frame at 7.7 km/s. The
follow now holds a yaw and pitch in the SATELLITE'S OWN FRAME (up = the local
radial, east = pole × radial) and a drag turns them, with OrbitControls held
off for the follow (`controls.enabled = false`, given back by `endFollow`).
Escape, closing the card, or scrolling out past the follow's reach lets go.
`followFrame` gives the view direction and a screen-up of
`sin p · radial − cos p · horizontal`, which is never parallel to the view, so
there is no singular pitch, overhead included (pinned in
`layer-park.test.mjs`). The orbit TARGET stays on the planet's centre: the
render loop still calls `controls.update()`, and the camera between that and
the satellite's `onBeforeRender` is what the tile refine and the near plane
measure from. Verified headless: two drags and 2.5 s later, the ISS model
still 436 m away and dead centre (NDC 0, 0).
## Weather in motion, forecast hazards, cyclone cones and the 3D air

Four Earth-only modules; each is a pure half with tests and a page half.

- **`flow-field.js` / `flow-layer.js`** — wind (GFS 10 m, 850/500/250 hPa)
  and ocean currents (Open-Meteo marine, with SST) as moving streamlines, and
  the forecast hazard sheets (rain, gusts, CAPE, heat, cold, snow). **Wind
  direction is FROM, a current's is TO** (`uvFromSpeedDir(…, "from"|"to")`).
  A view field is stacked over a coarse world field, and the fine field's NaN
  (the coast) is NOT overruled by the coarse one. Interpolation skips
  zero-weight corners, or a NaN beside a point refuses the point. The view is
  tracked in the frame loop, not on `onViewSettled`, which misses eased moves;
  particles outside a new box respawn at once. Over a sheet of the same
  quantity the lines are drawn white, and a hazard below its `floor` leaves
  the sheet clear, or the globe washes out.
- **`cyclone-cone.js` / `cyclone-forecast.js`** — GDACS active storms, the
  observed and forecast track, and the agency's cone where GDACS carries one,
  else the NHC two-thirds circles along a 3-hourly track. GDACS dates are
  dd/mm/yyyy, read day first. `threatAt(lat, lon)` is the seam the risk score
  asks.
- **`atmosphere-model.js` / `atmosphere-panel.js`** — Atmosphere ▸ 3D
  atmosphere model: GFS on 25 pressure levels (Open-Meteo,
  `models=gfs_seamless`, `wind_speed_unit=ms`) for an n × n lattice over a
  box, derived per node (Bolton e_s and θe, q, θ, ρ from Tv, w from ω),
  classified per cell by layer (ground, boundary layer within 1.5 km of the
  ground, free troposphere, tropopause layer within ±1.5 km of the WMO
  tropopause, stratosphere), and written as a .vtu with a .pvd that carries
  the hour. It is handed to `GeoIDGalesResults.openFolder` — the Etna
  tomography's road — and filed into `post_processing/atmosphere/` when a
  project is open. The layer is the cell array `material`, so Threshold by
  domain picks a layer and Statistics by domain summarises by layer. Heights
  are exaggerated in the DRAWING only; the true height rides along as
  `height_m`. Verified with synthetic ISA columns: 8 × 8 × 20 levels, 1,280
  nodes, 6 × 931 tets, four layer domains, opening on temperature −56.5 to
  14.7 °C.
## Climate change over time: one composite a year, read against a baseline

Earth Observation ▸ Atmosphere ▸ "Climate change over time"
(`climate-change.js`, pure, 41 checks; `climate-change-panel.js`). One Earth
Engine composite of the same WINDOW (whole year, a season, a month — DJF is the
winter ENDING in the year named) for every year asked for, through the same
`fetchScene` and palette inversion as every other GEE reader, then:

- **anomaly** per pixel against the mean of the baseline years, played through
  the one time-lapse bar on a diverging palette whose range is fixed across the
  sequence (98th percentile of |a|), so a colour means one departure in every
  year; the bar parks on the latest year;
- **trend per decade** as a layer of its own: Sen's slope (median of pairwise
  slopes, robust to a wild year) with Mann–Kendall (Var S = n(n−1)(2n+5)/18,
  continuity-corrected Z, two-sided p); p ≥ 0.05 drawn at a third of the alpha;
- **area series** in the card, cos(lat)-weighted over the pixels valid in EVERY
  year (else per frame, and it says so), with its own Sen's slope; CSV through
  `downloadText`.

**Variables are the deployed curated datasets only** — LST (MOD11A2, 2001–),
CHIRPS rain (1981–, ±50°), NDVI (MOD13A2, 2001–), SMAP (2016–) — pinned against
`services/gee-tiles/index.js`. A window still running is never asked for (a
partial composite's anomaly is the missing part). A summed rainfall composite
past a day runs off the deployed 0–300 mm ramp, so the panel defaults rain to a
month, passes the (not yet deployed) `max`, and counts pixel-years at a ramp
end in the status line. Each year is one billed render; past 30 the button
asks for a second press. Both sheets answer a click (`probeAt`, in the
feature-popup sheet chain): that pixel's value, anomaly, baseline and its own
trend with p.

Verified with a mocked service (25 synthetic JJA scenes, 64 × 48, the east half
warming 0.8 °C/decade, a no-data corner): 25 renders, trend 0.75 °C/decade
east (palette quantisation) at p 3e-7 and 0 west at p 0.98; 1,536 of 3,036
valid pixels significant — exactly the east half; area trend 0.40 = half of it.
## The events' name chips used a HEMISPHERE test, and named a continent

Reported from 20 km over Norway, oblique: chips for floods in Iceland, Spain
and Portugal, wildfires in Ukraine and Albania and a Greek earthquake, drawn
over the fjords with no marker under any of them. The label pass culled with
`world · camera > 0` — which keeps the whole near HEMISPHERE, not what is above
the horizon. The markers were right all along: `cullBehindGlobe` uses the
tangent-plane test p · c ≥ R² in the cloud's own frame. The chips now use the
same test in the same frame (and skip a hidden cloud). At 20 km up an event
1,500 km away is 13.5° round: p · c ≈ 9.99 < R² = 10.24, culled; the old test
passed it. The pin that asserted the hemisphere test was re-argued, not
deleted. Any "behind the globe" check must be the horizon, not the hemisphere.
## Air and sea traffic: the satellite tracker's arrangement over ADS-B and AIS

Earth Observation ▸ Air and sea traffic (`gis/traffic.js`, the page half;
`gis/traffic-feeds.js`, pure, 66 checks), nested beside Satellites by a MOVES
entry. Two trackers, "Live aircraft (ADS-B)" and "Live ships (AIS)", each
built the way the satellites are: an `addDerivedLayer` row with its eye and
legend, dots in a nested band-198 group, a screen-space picker on a capture
click, the corner card through `featureToItem` + `openSceneFeature` (owned
through card-owner), a fly-to and a follow (`followFrame` imported from
satellites.js, drag to look round, wheel to zoom, Escape to let go), and the
craft drawn as a MODEL at true size close in — an InstancedMesh per STL part,
camera-relative, within 2,000 lengths of the camera, the near plane lowered
when one is close.

- **Feeds a browser may call with no key of ours.** Aircraft: adsb.lol, then
  airplanes.live (both the ADSBExchange v2 shape), then OpenSky's anonymous
  states, tried in order with the last good one first, every 10 s over a
  circle round the view centre (`radiusForView`, capped at 250 nm, refetched
  early when the view moves half the radius). Ships: Fintraffic's Digitraffic
  (CC BY 4.0) when the view is over the Baltic, else aisstream.io over a
  WebSocket with the READER'S OWN free key, which stays in their browser
  (`geoid-gis:aisstream-key`) and is wiped only by the explicit wipe — the
  ordinary membership sweep must not take a free reader's ships away.
- **One normalised record per craft** and `deadReckon` (the destination-point
  formula, capped at 90 s) between reports; dots move once a second, models
  every frame. Heading 511 in AIS means none (course is used); `alt_baro:
  "ground"` means taxiing, never extrapolated; `timeMs: 0` is a time, not an
  absence (`Number.isFinite`, or the test's own fixtures read as "now").
- **An aircraft stands its own height above the DRAWN ground**:
  `3.2 + elevationNormalized × getEffectiveRelief()` plus (altitude − DEM
  ground) at true scale. Placing it above a bare sphere puts every low flight
  inside the exaggerated relief from orbit. Read through `elevationNormalized`
  and `latLonToVector3`, never the seam's `surfacePoint`, which CACHES by
  position — a thousand moving craft a second would grow it for the life of
  the page.
- **Dots draw with the depth test OFF** (at the drawn ground the relief would
  bury them) and the far side is put away EVERY FRAME by the tangent-plane
  test p·c ≥ R² in the layer's frame (`dotStep`), the events' rule. A craft
  drawn as a model wears its dot just over it, on screen.
- **The model frame is a pure function**, `headingBasis(position, heading,
  pitch)` in traffic-feeds.js, tested against `deadReckon` through the
  viewer's own `latLonToVector3` formula written out independently: forward
  is the direction of travel at five places (cos > 0.9999), port is west
  heading north, a climb lifts the nose. Models are baked by
  `services/bake-traffic-models.py` (stdlib, reusing the satellite bake's
  Mesh): a generic 37.6 m airliner and a 200 m cargo ship, three parts each
  (the tinted part wears the category colour), scaled per craft to its
  emitter-category or AIS-dimension length — the right SIZE, not the right
  type. Every part encloses positive volume (outward winding).
- **What a fetch brings is drawn at once** (`tick` after every refresh), and
  a craft focused before its first tick is placed by the fly-to itself —
  measured, focusing a ship the moment its fetch landed found no position and
  the flight never left.
- The corner card renders `extra_rows` as TEXT (feed values are not markup),
  passed through `featureToItem`; the card is redrawn with each new report
  while open.

Verified headless with the feeds mocked by `page.route` (the sandbox proxy
refuses all four hosts): 60 aircraft drawn and legended 5/13/31/11 by band, a
real click on a dot opening its card and flying to it, the follow holding a
true-size airliner at 4 km with the card's altitude, speed, type and
registration rows; 40 ships from Digitraffic, a ship followed at 270 m with
its 109 m model; unticking both leaves no layer and no label.
## Roads and city outlines: Natural Earth for the world, Overpass for a place

Map ▸ Overlays gained a **Roads** and a **Settlements** group (registered in
`GROUPS`, or the catalogue test refuses the rows): Natural Earth 1:10m roads
and urban areas fetched live from Natural Earth's GitHub (public domain; live
like the plate boundaries only because this sandbox cannot publish to the
bucket — `publish-data.py` can move them later), and two Overpass connectors
in `research/connectors.js` (pure, tested in `connectors.test.mjs`).

- **A row may take the VIEW when nothing is drawn** (`areaFrom:
  "drawn-or-view"`, `viewBbox()` in global-data.js). A view that sees too little
  of the globe answers nothing and the connector refuses in its own words.
- **Roads are tiered by the box's size** (`ROAD_TIERS`, span = longer side with
  longitude × cos lat): every street under 0.15°, tertiary to 0.6°, secondary to
  2°, the main network to 6°, refused beyond. A `_link` is filed under its class.
- **A city's outline is found FROM THE PLACE.** The query takes the city/town
  nodes, asks Overpass which admin boundaries contain them (`is_in` + `pivot`),
  and keeps the one that carries the place's name (`placeNameKey` strips
  "City of", "Landeshauptstadt", accents; keeps other scripts). An area mapped
  AS the place outranks it; among same-named boundaries the deepest at admin
  level ≤ 8 wins, so a same-named ward never takes a city's place. A town with
  no boundary of its own name gets NO outline rather than its county's.
- **Relations are bags of ways**: `assembleRings` joins pieces in any order and
  direction and counts a ring that cannot close rather than drawing it.

Verified headless with Overpass mocked: 30 roads classed by `class`, and
Edinburgh drawn from "City of Edinburgh" (level 8) over a drawn area.
