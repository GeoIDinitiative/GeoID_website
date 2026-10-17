# GUI panels and catalogue: nav taxonomy, Workspace, workbenches, tabs, cards, catalogue rows

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

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
The CONTOURS are set in Map ▸ Elevation only, on the real `#contour-*`
controls (`#contour-controls`: interval, opacity, colour — earth-viewer reads
all three by id). They were also offered as a "Terrain" group of catalogue
rows in the Overlays list, proxies onto the same three inputs; that was two
places to set one overlay and the rows are gone (`polygons.js` says so, and
`catalogue-panels.test.mjs` fails if they return).
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
## One list per subject, and provenance lives in the Metadata tab

Four reports on one screenshot of the Ice cover subtab, and three of them are
the same fault: a subtab that had grown its own furniture beside the catalogue
it already had.

**A TILED LAYER IS A CATALOGUE ROW.** Two of these lists hold a layer
`global-data.js` cannot describe, because it is not a file: the world's
contacts and faults, and the glacier inventory. Both are tile services driven
by `geology-panel.js`'s machinery, and each had grown its OWN bespoke tick —
the contacts appended after the list by `catalogue-panels.js`, the inventory
built above it by `ice-cover-panel.js`. Two shapes of control for one kind of
thing, and the only rows in either list with no ⓘ.

`TILED` in `catalogue-panels.js` is one registry keyed by home: each entry
declares `ready`, `layerOf`, `load` and `unload` against its own module's seam
and nothing else, and is merged into the list for its home BEFORE it is drawn —
so it takes the same row, the same group heading and the same info card as
everything beside it. `ice-cover-panel.js` keeps only what a catalogue
genuinely cannot hold (the change subtab) and publishes
`window.GeoIDIceCover = { load, remove, layerOf }` for the row to drive.
Measured after: one box, three groups — Global inventory, Ice sheets, Live
services — three rows, an ⓘ on every one, and the contacts row now inside the
Tectonics group rather than orphaned under the list.

**A tiled row reports itself like the rows beside it.** An ordinary row's
`addDataset` writes "X added. <licence>."; the tiled ones wrote nothing, so the
Tectonics list went silent when the mechanism changed. An entry may carry
`added` for that — the inventory does not, because it writes its own richer
line once its tiles have landed and a generic one would overwrite it.

**THE UNTICK IS THE REPORT, on every path.** "Ice sheets and shelves —
Greenland and Antarctica (Natural Earth 1:10m) taken off the globe." restates
what the empty box already says, and then sits there describing something no
longer on the globe. The status is cleared instead — and cleared FIRST, before
any branch returns, because the tiled path returns early and left the last
load's message standing over an empty list. That was measured, not reasoned:
the first version cleared it at the bottom and the contacts row still read
"added" after being removed.

**PROVENANCE LIVES IN THE METADATA TAB, so it has to actually be there.** The
subtab carried a "Sources" fold listing RGI, GLIMS and Natural Earth — a fourth
place to state what the Metadata tab exists for. Removing it exposed two real
gaps, and both had to be closed first:

- **A tiled layer had no `metadata` at all**, so the glacier inventory read
  "Source: user import, CRS: unstated". `loadDerivedGeologyMap` takes one now
  and it rides on the ENTRY rather than being written onto the record, because
  this layer re-registers itself whenever the view settles and anything written
  once is gone by the next refine.
- **A SHIPPED catalogue file had none either.** `addDataset` wrote `metadata`
  only in the connector branch, so a live BGS layer named its endpoint and its
  licence while Natural Earth beside it said "user import". Every catalogue
  layer states source, citation and CRS now. Measured: the ice sheets arrive
  with `/data/global/ice-sheets.geojson` and "Natural Earth — public domain".

**And "Ice in the geological compilation" is gone from the list.** It was there
so the geology layer's ice FILTER could be checked, which is a developer's
question rather than a reader's. The predicate stays exactly where it matters —
keeping ice out of the geological map — and `ice-cover.js` is untouched.
## A scroll container clips its own tail

`overflow-y: auto` makes an element a scroll container, and a scroll container
clips its `::before`/`::after` to the padding box. A tail drawn on a card's
outside edge is therefore cropped off at the very edge it grows from — present
in `getComputedStyle` (50 px of fill, 52 px of border) and absent from the
screen. "No change in label shape" was exactly right while every measurement
said the CSS was applied: the measurement confirmed the rule EXISTED, not that
it was painted. The scrolling belongs to an inner wrapper; the card keeps a
shape.

Two triangles make one bubble: `::before` is the border, a pixel larger, and
`::after` is the fill pulled a pixel BACK OVER the card so the card's own
border is broken where the tail joins. Flush at the edge, that border rules
straight across the base of the divot and the tail reads as a separate shape
stuck under a closed box.

And check what colour the label actually IS before matching anything to it. The
card's border is not the theme accent its tail and kicker use — it pulses gold
under `scene-popup-focus-pulse`, and tying the outline to the accent produced
four parts in three colours.
## A clamp holds a card in; it must not hold it back

The geology card's clamp ran whatever the ground it points at was doing, so
rotating the globe left the card parked at the margin with its tail aimed at
whatever happened to be under the edge — a label for a unit nobody can see.

The clamp now applies **only while the anchor is on screen**. That keeps what
it was written for (a card whose unit is in view is pulled inside the canvas,
so the hub's nav bar cannot cut off its first rows) and drops what it was not
(holding a card back from ground that has already gone). Measured: anchor at
242/528/815 px, card exactly on it; anchor at 1101 with a 320-wide card, card
pulled in to the 1037 limit; anchor driven off to −3,950 px, card tracking it
to the pixel the whole way, then hidden when the anchor passed over the
horizon.

The horizon test is separate and unchanged — that is what stops a card being
drawn for ground on the far side of the planet.

Note the two geology cards are different objects: this one (`#geo-popup`,
kicker "GEOLOGIC UNIT") tracks its anchor every frame; the GIS stack card
(`gis/feature-popup.js`, "MAPPED AREA") is placed once beside the click and
does not track at all.
## `.gis-tool-grid` is TWO COLUMNS, and using it as a stack wrecks a tab

"The cyclone tab is now structurally a mess", and it was — a 100 px magenta
button sitting beside a tick row, under two walls of prose. One cause:
`.gis-tool-grid` is `grid-template-columns: repeat(2, minmax(0, 1fr))`, and I
appended a button, a `.row` and two paragraphs into it as though it were a
column. So the button landed in column 1 with the tick row beside it, and every
grid row grew to its tallest cell — which is what stretched the buttons.

**The column's own idiom is three parts**, and the ice time-lapse next door is
the same three in the same order:

| | |
| --- | --- |
| `.row` | one label, one control — a grid, `1fr` and `minmax(8rem, 11rem)` |
| `.gis-btn-row` | a flex run of buttons, each `flex: 1` so they share the width |
| `p.compact-copy` | prose, at the body's own width |

Measured after: both buttons 34 px tall on ONE row (127 and 159 px wide), the
whole subtab body 334 px, and nothing overflowing it.

**ONE PLAYER, so one status line and one button row.** Starting either sequence
stops the other — that is `timelapse-player`'s own rule rather than a
coincidence of these two buttons — so two status paragraphs were two ways to
say what one player is doing, and an empty one still carries its margins (the
dock's own empty-status lesson). `#cyclone-play-status` is the one line both
modules write to.

**And the raster's control wires on the BUTTON, not on a wrapper.** It shares
its row and its status with the season animation, so it has no host of its own
to key on — and a div kept only to be wired is an element that exists to hold a
boolean.

### The copy belongs on the FRAME, not in front of the controls

Two paragraphs explaining that a season is a count and a thin estimate is noise
were most of the mess, and both claims were already being made where they
matter: a season's key reads "Storms within 200 km in 2005" and a thin frame
says "1 season of record, mostly sampling noise". Standing copy repeating them
is a wall of text in front of the controls it describes. One line survives —
"Seasons plays what happened; the estimate plays how well it is known. Each
frame says which." — and the longer explanation of the follow tick moved to its
`title`. Same rule this file already states about the pre-satellite frames: the
honest answer belongs on the frame rather than in a footnote.
## A play button belongs on the ROW of the layer it plays

The cyclone tab had two full-width buttons standing under a paragraph telling
the reader which box to tick first. `entry.play` puts each one on the catalogue
row of the layer it animates instead — gated on that layer being loaded, beside
the Symbology button and the label-detail slider, which are on the row for
exactly the same reason: **a control that acts on ONE layer, parked in the
subsection instead, has to name that layer in words and then be kept in step
with it.** Gated, the button simply is not there until the tick has been made,
which is what retired the sentence.

It is a SEAM, not a cyclone special case: any entry naming one gets a button
and one that does not gets none. `stopPropagation` on the click, or it reaches
the row's own handler and unticks the layer being played.

Measured: nothing ticked → each row shows only its ⓘ; tracks on → "▶ Play
seasons" on the tracks row alone; both on → each row carries its own. The
subtab body went **334 px to 209**.

**The season span moved BELOW the rows**, because it qualifies a button up
there rather than standing on its own — read after the thing it modifies.

### The follow tick is gone, because loading the risk map is the decision

It did work — verified, the risk map stepped 1980→1983 with the seasons. It was
still a second switch for one decision: putting the risk map on the globe and
pressing play on the seasons beside it already says what you want. That is the
volcano Names button's own fault, whose reasoning is still written in
`catalogue-list.js` ("a button that toggled what the tick box already implies
was a second switch for one decision").

Safe to make automatic only because it is REVERSIBLE AND SAYS SO: the key
changes with the map — a season's classes are counts, the climatology's are
return periods — and closing the bar puts the climatology back. Verified both:
the map follows with no tick anywhere, and closing restores "Chance of a storm
passing within 200 km" with its summary cleared. `followRisk()` is now just
"is the risk layer there".

### BOTH catalogue projections have to carry a new field

Third time in this file's history. `catalogue-panels.js` and `polygons.js` each
reduce an entry to a fixed shape, and a field left out of one falls back
SILENTLY — it is how the submarine cables came to be captioned "Erupted since
1500", and here it was a play button that never appeared while the Symbology
button on the same row was fine. Pinned now: the test asserts both projections
carry `entry.play`.

**And the check went in ABOVE that file's summary line.** `catalogue-panels.test.mjs`
ends with `process.exit`, so anything appended after it runs and is discarded —
one of the two files this repo already documents for it. A first attempt
inserted the block at the top of the file instead, which at least failed
loudly; the discarded-check version would not have.
## Two faults from one change: a second ⓘ, and the wrong tab lit

Both reported off one screenshot of a Workspace row, and neither is where it
looked.

### The ⓘ belongs where the layer was TICKED, and only once

"A layer carrying `info.maths` gets the same button from wherever it is" was
written for the layers with NOWHERE ELSE to say it — the Factor of Safety layer
GeoID mode builds, the streamed DEM sheets, the thickness sheet. None of those
has a catalogue row. **A catalogue dataset does**, and its row in the nav tab
has carried the ⓘ all along — so the moment a catalogue dataset first carried
`maths`, there were two doors to one card on one screen.

Gated on `!isCatalogueLayer(layer)` now. The test pins both halves: the
Workspace row stands down for a catalogue layer, AND the three layers the rule
exists for are checked to have no catalogue entry to defer to — so a future
dataset with one of those names cannot silently take their button away.

**The general shape**: a rule written for "the layers with no other home" is
wrong the day something with a home meets it. When adding a property to a
catalogue entry, ask what ALREADY draws from that property.

### A home whose section is not in the table lights the WRONG tab

`HOME_SECTION` was a hand-written table of three homes, and the catalogue has
six. Ice, soil and hazards all fell through to the default — and the default is
`basemap-relief-section`, so ticking a cyclone dataset lit **Basemaps**. That is
worse than lighting nothing: the fill is a claim about where the data is, and
it was pointing at the wrong tab while the tab that held it stayed dark.

It reads from the DOM now: `HOMES` already says which element hosts each home's
list, and `closest("details[id]")` says what that element sits inside. Self-
maintaining, and it carries the per-body differences a table cannot — Mars
keeps Hydrology as its own tab where Earth folds it into Earth System, which is
exactly why the nested-parent walk below it already worked this way.

The fallback stays for the HOMELESS catalogue (graticule, borders, countries,
cables), which genuinely has no home and is offered from Basemaps. That is what
a default is for — not for a home whose section nobody listed.

Measured: nothing ticked → Hazards dark, Basemaps dark; a hazards dataset on →
**Hazards lit while collapsed, Basemaps still dark**. The sub-tab was never
broken — `.gis-catalogue-row input[type=checkbox]` is already a `DATA_CONTROL`,
so `markSubsections` lights Tropical cyclones from its own ticked rows.
## One entry for the tracks, and the bar opens with the layer

Two changes, and the second is only safe because of where the bar parks.

### The two track maps are ONE row, two files

They are one subject read two ways — every storm on record, or only the
stretches at hurricane force — so they are one entry with a switch, not two
rows a reader has to notice are related.

**It is not a repaint, and that is the honest difference from the risk map's
toggle beside it.** The all-storms file is 13,513 whole tracks; the hurricane
file is 3,700 sub-stretches. Different geometry, so the switch LOADS THE OTHER
FILE. What makes it one row is that the entry's `path`, `name`, `summary` and
`colourRange` are GETTERS over the active variant, read at load time — so the
tick, the ⓘ and the layer stay one thing, and the separate
`cyclone-tracks-hurricane` entry could be deleted outright.

The class labels differ by one band, which is the honest part: the all-storms
layer opens BELOW hurricane force so it has six, and every value in the
hurricane file is at or above 64 knots, so nothing could fall in a lower one.

### The bar opens because the layer is on, and parks where the layer is whole

The play buttons are gone. A button is a second decision for one intent —
somebody who ticks a sequence on has said they want to look at it — which is
the volcano Names button's fault, now removed from this tree three times.

**WHAT MAKES IT SAFE IS THE PARKING FRAME.** A bar opening on frame 0 would
answer a tick for "every storm on record" with 105 storms of 13,513, and the
last SEASON is no better: 2026 alone is 75. So the season sequence gains a
terminal **"All"** epoch that shows the layer itself, unchanged — ticking
changes nothing about what is drawn, and every step back from there is pure
gain. The estimate needs no such frame: its last band already IS the
full-record climatology, so it opens on `epochs.length - 1`.

**And the seasons build ON DEMAND.** Building all 47 up front cost half a
second and twice the geometry, which is a bill nobody asked for when the bar
opens on a tick rather than a press. A reader who never scrubs pays nothing.

`animated-layers.js` decides only WHEN — each driver names its own parking
frame. One bar, because there is one player: ticking a second animated layer
hands it over, which is the player's own rule. Unticking the owner puts the bar
away, and the ✕ is caught by a poll rather than by wiring into every close path
the player has — miss one and this module believes it still owns a bar that is
gone, after which re-ticking never reopens it.

### Two faults the live pass caught, both silent

- **`tracksLayer()` matched the layer's NAME**, which was right until the entry
  grew a variant: switched to hurricane force the layer is called "Hurricane
  tracks", the pattern missed it, and the driver reported "tick the cyclone
  tracks on first" over a ticked layer — because a driver that cannot find its
  layer says exactly what one that has none says. It asks
  `layerForDataset("cyclone-tracks")` now, which follows the variant by
  construction.
- **The bar called 3,700 runs "3700 storms"**, overstating the count by a
  quarter (they are 3,700 runs over 2,929 storms) and misnaming every one. The
  noun rides on the frame and the driver picks it from the layer it is playing.

Measured end to end: tick → "All · 13,513 storms"; switch → "All · 3,700 runs"
with the layer renamed and one tracks layer on the globe; untick → bar gone,
owner null. The risk map: tick → "2026 — the estimate after 47 seasons",
untick → gone.
## A colour choice belongs on the symbology button, and must be instant

"This is a mess" — a row carrying a "Hurricane force" button beside the one
marked "Symbology…", under a heading repeating the tab's own name.

- **A heading over the ONLY group in a list says nothing.** Group headings
  separate; with one group there is nothing to separate it from, and the word
  is a second label over a list whose tab already carries it. Counted rather
  than switched off per entry, so a list that grows a second group gets its
  headings back without anybody remembering to.
- **The button is gone and the choice is a row in the symbology dialog**
  (`layer.symbologyViews`). Choosing between "every storm" and "only those
  that reached hurricane force" is a COLOUR decision, and a control doing a
  symbology's job next to the one marked Symbology is two controls for one
  idea. It applies on `change`, not on Apply: it repaints what is on the
  globe, and waiting for a second press hides the one thing that makes it
  usable — seeing the difference while choosing.
- **EVERY OPTION MUST BE AN INSTANT REPAINT.** That is what killed the file
  swap. Switching to the hurricane-RUNS file dropped the layer, rebuilt it and
  painted it a beat later — reported exactly as "it changes colours in
  stages", and no amount of care makes a reload instant. So the tracks entry
  loads ONE file and both views repaint it. The runs file
  (`cyclone-tracks-hurricane.geojson`, 3,700 stretches) is still baked and
  published, and is a different product: it holds the STRETCHES at hurricane
  force, where this option highlights whole STORMS that reached it. The option
  is named for what it does, because only 47% of Katrina's track and 13% of
  Sandy's was at that strength.

### A VIEW IS THE COLOURING, so it cannot also have a `colourRange`

Both were running — the view's paint first and `paintByRange` a moment later
over the top — so the key on LOAD disagreed with the key after a switch and
back, and the second was the true one. It took a round trip through the dialog
to see it at all. An entry that declares `views` no longer runs `colourRange`;
measured after, load and return agree to the row.

### `Number(null)` IS ZERO — and it was miscounting a legend

The oldest trap in this file, found in `paintByRange` itself. It classed with a
bare `Number()`, so every feature with no value became 0, passed `isFinite`,
and was COUNTED. Its paint has always guarded nulls and left such a feature
uncoloured — so **the map was right and the key was not**: 7,267 of the 13,513
cyclone tracks carry no measured peak wind, and all 7,267 were counted into
"Tropical storm or weaker", a class whose swatch none of them is drawn in, with
the bottom break dragged down to meet them. One `readValue` now serves the
classing and the paint, so the two cannot disagree about what a value is.

**And the grey needed naming, twice.** It means two different things — a storm
measured below the threshold, and a storm nobody measured — so the key says
"Peak never measured" on the default view and "Below hurricane force, or never
measured" on the other. Calling that row "never reached hurricane force" would
state a strength for 7,267 storms with no reading at all, which is the one
thing that colour must never be read as. Both keys sum to 13,513.

**I wrote the same bug into the new module while fixing its symptoms** — a bare
`Number()` in `trackPaint`, caught by running the pure function rather than by
reading it. Every unmeasured storm came back green. When a column can be null,
write the guard before the arithmetic.
## The bar's note is 104 px, so it counts rather than describes

"Can't see the 5733…" — and the measurement is the whole story: `.tl-note`
declares `max-width: 15rem` and was being handed **104 px of a 130 px
sentence** by the flex row, so "13513 storms, 5733 named" reached the reader as
"13513 storms, 5733…". The half that got cut was the half the other half
needed.

Two fixes, and the first is the one that generalises:

- **The note keeps its own width** (`flex: 0 1 auto; min-width: max-content`).
  It is the only part of the bar that says anything about the frame, and as an
  ordinary flex item it was giving its width away to its neighbours. The 15rem
  cap stays — that is what stops a long note pushing the close button off a
  narrow screen.
- **A COUNTER, not a description.** `105 / 13,513` is shorter than what it
  replaced AND says more: how much of the record this frame is, which is the
  question a sequence invites. The All frame names the archive instead
  (`13,513 storms`), because "13,513 / 13,513" is a fraction of itself and
  reads as a number that failed to update.

**And the sentence too long for the bar goes on the TITLE rather than being
cut.** `noteTitle` is a second seam beside `noteFor`, carried by the player, so
a driver can say more than fits without losing the end of it — and the end is
always where a qualification lives. The pre-satellite claim stays visible in
short form ("— pre-satellite") because it is a claim about the number beside
it; the reason it rests on ("recorded where ships and coasts were") is on the
tooltip.

Measured after, stepping back through frames: nothing clipped at any of them,
and the bar came down from 573 px to 497.
## A frame standing in for a dataset has to keep that dataset's tab lit

The Hazards header went dark **at the moment its data was most obviously on the
globe** — mid-animation, with a cyclone season drawn across the Atlantic.

Two facts meeting, and each is correct on its own:

- the whole-record tracks layer is DELIBERATELY hidden while a season is shown
  (it would otherwise draw every storm behind the one year on screen), and
  `isOn` reads visibility;
- the derived season layer that replaces it has no catalogue row, so the
  activity pass had nothing to file it under and dropped it in Workspace.

So the only visible cyclone layer was attributed to the wrong tab while the one
attributed correctly was invisible. **A derived layer may now name its `home`**
— carried by `addDerivedLayer`, read by `activeSections` before the name
guesses below it — and both cyclone drivers declare `hazards`.

Deliberately a HINT the caller gives rather than something inferred: a clip or
a tool output genuinely belongs in Workspace, because somebody made it and it
lives with their working set. What is different here is a layer standing IN FOR
a catalogue dataset, and only its author knows that.

Measured, collapsed: dark with nothing ticked, lit on the All frame, **still
lit on a season frame with the whole-record layer hidden**, and Basemaps dark
throughout.
## One dataset, one thing drawn, one card

"We have a clash now for the risk map" — two sheets over each other and TWO
legend cards for one tick, each describing what the other was covering.

**The view owns what is visible.** The grid and the estimate animation are the
same numbers drawn two ways, so only one is ever up: `setView` hides the grid
AND withholds its legend for the estimate, and stops the animation and brings
the grid back for a rate view. Three readings on the symbology row —
**"The estimate over time" (default), "Rate per year — any cyclone", "Rate per
year — hurricane force"** — and one legend card in every state. The estimate
can be the default without hiding anything, because it opens on the full-record
band, which is the very map the grid draws.

**And the sheet answers clicks for the grid it covers.** With the grid stood
down, a click found nothing — so the cell card, which is the only place the
number is written in words, was unreachable on the default view. The frames ARE
that grid's numbers, so the drape borrows its features: the cell under the
pointer is the cell being drawn.

### OPENING IS NOT YET RUNNING, and the gap was seconds wide

The clash only appeared when a race was lost. `play()` reads the COG's header,
decodes a band and drapes it — about twenty seconds cold — and for all of that
there is no bar and `running` is still false. Two callers legitimately ask for
the default view in that window: the catalogue applies the entry's view as the
layer lands, and `animated-layers` opens the bar when it sees the layer arrive.
Both passed every guard, two sequences built, and the second one's teardown ran
the FIRST one's `onStop` — which restores the grid. Hence two sheets and two
cards, intermittently.

Guarding on `running` or on the bar existing is not enough; both are false
while the thing is being built. An explicit `opening` flag is, and the season
sequence needed the same one for the same reason.

**A closed bar stays closed, too.** The poll reopened it on the next tick, so ✕
did nothing at all — press it, watch it come back. A dismissal now lasts until
the layer leaves and returns, because re-ticking a dataset is asking for it
again.
## A card describes something on the globe, so it goes when that thing does

Two reports, one theme: the cards did not know where they belonged.

**An event card opened from the LIST landed over the legend.** A row click
passed no position, so `selectEvent` fell back to `feedAnchor()` — a fixed
spot left of the feed, which is the legend's corner — while a dot click put it
at the pointer and then flew the camera, leaving the card behind its moving
dot. Both now place the card BESIDE THE DOT every frame (`trackPopup`, run from
the selection ring's own frame loop, which already follows the marker through
spin, zoom and relief): right of the ring, flipped left at the window edge,
and hidden — `visibility`, never `hidden`, because the seismogram loader reads
`node.hidden` as the card having moved on — while the dot is round the back
(the `p · camera ≥ R²` horizon test; `GeoIDProjectLatLon` does not cull).
Measured: card left edge = dot x + ring radius + 10 px, at rest and through a
fly-in from off screen.

**Cards lingered after their layer left.** Leaving GIS and the feed's own
master tick were already clean; the Workspace EYE was not — hide Live events
with a card open and the markers went while the card and its ring stayed. Every
card had this shape of fault: each closed on the gestures its own module knew
about, and none knew its layer could go away under it.

`gis/card-owner.js`: a card CLAIMS the layer it describes when it opens, and is
closed through its own closer (outline and ring included) the moment that
layer is hidden, removed or unticked. Three rules make it safe:

- **One owner per slot** — `event`, `feature`, `viewer` (the geology and scene
  cards share one because only one is ever open). A newer card replaces the
  claim, so an OLD card's layer can never close the card that replaced it.
- **Matched by name as well as id.** A tiled layer can rebuild as a new object;
  by identity a geology card would close every time the view settled.
- **Checked a beat later (250 ms) and re-checked**, so a swap mid-rebuild is
  not read as the layer leaving.

The claim lives where the cards MEET, not with each caller: `openGeoPopup`
claims by `feature.source_layer` (the geology catalogue, feature-popup's vector
hits and the raster probes all set it — the probes now do), and the scene-card
opener claims by the item's `source_layer`, which `point-labels` now stamps on
every label and dot item. An event card also closes when its event stops being
drawn (its feed unticked, a refresh that drops it) — the layer can stay on
while one event leaves it.

**What no layer owns, the page switch puts away**: leaving GIS pauses a running
time-lapse (hidden by its own sheet under `body.studio-open` /
`body.research-open`, found where it was on return), and any page but Model
closes the studio's part card, which lives on `body`.

Verified live, each with a real click where one was needed: event card ×
Workspace eye, × its own feed unticked (and an earthquake card left open when
the wildfire feed goes — the control); plate-boundary card × its catalogue row
(card and gold outline); world-geology card survives a zoom-in refine, closes
on the Geology tab's tick; volcano scene card × layer eye; time-lapse paused
and hidden on the Model page, back on return; part card gone on GIS and
Research.
## The full sweep: doors that only opened, rows filed by transport, a slot over the clock

Measured page-wide rather than read: nine tabs and 49 subtabs opened with no
console error, no overflow and no broken image; ui.py 14/14, smoke.py 64/64,
sidecar.py all green. What the sweep found, and the rule each one leaves:

**A DOOR TOGGLES, and a MODAL closes on Escape.** Of the Workspace header's
four doors, + Data opened a modal that Escape shut, while + GEE, Export and
Settings opened and then ignored both Escape and a second press, so the only way
out was a ✕. All three toggle now through their seams' own `isOpen`/`close`
(`GeoIDGeeCatalogue` gained both; `GeoIDSidePanels` already had them). The GEE
window is a MODAL, so it also closes on Escape, like + Data. Export and Settings are
WORKBENCHES, the same kind of object as Geoprocessing and Analysis, and none of
the four takes Escape. That is deliberate. Escape already closes a card and
cancels a drawing, and a non-modal panel that took it too would compete with
those for the one key. Measured: + Data and + GEE close on Escape; + GEE, Export
and Settings close on a second press.

**A ROW IS FILED BY WHAT IT IS, NOT BY HOW IT ARRIVES.** Map ▸ Overlays held
six "Live services" rows only because they named no home. The four fire
layers (NIFC perimeters and three FIRMS detections) now live in
Hazards ▸ Wildfires, beside the burned-area share already there. NWS alerts and
HadUK rainfall normals now live in Earth System ▸ Atmosphere. What is left in
Overlays is shapes and infrastructure: the graticule, borders, countries, OSM
places, cables and landings.

**A host in markup every world shares ships HIDDEN.** Atmosphere is rendered
from `panels.js`'s one MARKUP string for all ten worlds, and a weather list has
nothing to offer on Mars. The host sits inside a `data-catalogue-shell` details
shipped `hidden`, and `catalogue-panels.draw` shows the shell only once it has
rows. This is the GEE Service form's arrangement, so a planet never shows a
heading over nothing. The shell carries no `id`, so section-activity's
`closest("details[id]")` still finds the Atmosphere TAB; given an id, the
shell would light itself instead. The test's "page" is now the Earth index plus
the unescaped shared markup, because a host in the shared string is as real as
one in the index.

**THE SHARED DROP-DOWN STEPS LEFT OF THE CLOCK.** Below about 1,000 px
`#top-right-controls` drops under the tool rail, into the column the
events/legend slot hangs down. At 900 px the panel covered the clock's left
27 px. `slotFrom(rects, vw, gap, avoid, width)` takes the rects it must not cover
and moves the slot's right edge clear of them. Measured at 900 px: panel
488..768, clock 774. At desktop width nothing moves, because the clock is at
412. The panel's height is unknown at that point, so anything reaching below the
slot's top counts. A DOMRect has both `left` and `x`, while a hand-built test
rect may have only `x`, so read `left ?? x`. The test's own assertion fell into
exactly that trap.

**Two smaller things.** A catalogue tick's id is now unique per HOST
(`gis-cat-<host>-<entry>`). A mirrored row, such as the volcanoes seen from
Hazards, otherwise minted the same id twice. `tests/ui.py` derives runtime ids
from module source, so it reports what the page actually builds. The
time-rate range, the contour ticks and the sea-level slider on all six rocky
worlds now carry `aria-label`s: an unnamed range is a slider a screen reader
calls "slider".

**A sweep instrument that scrolls the panel lies about the panel.** Before a
narrow-viewport probe, I scrolled a subtab into view. That scrolled
`#ui-scroll-body`, and the probe then reported the brand, the ⓘ and the rate
pill 407 px above the frame. Reset every scroller the probe touched before
reading positions.
## "Still highlighted after ✕" was three faults, and none was the closers

Every closer was already clearing its own highlight: the geology card its gold
outline, the scene card its flash label, the event card its ring. The report
was still right. Measured with a probe listing every drawn object named like a
highlight (outline, halo, select, pulse, flash, pin: **not "spin"**, or
`eonet-spin-frame` reads as a lit highlight), there were three routes to a
highlight outliving its card:

- **One click raised TWO cards.** The event feed answers on `pointerup`; the
  viewer's pick does too, and the GIS card answers on `click`. Nothing
  arbitrated between them. Measured: a click on Calatrava raised the volcano card
  AND an M5.2 card 200 km away (a marker is big at that zoom); a click on a geology unit
  raised its card AND a wildfire card on top of it. Pressing ✕ on either left
  the other's outline or ring lit, its card hidden behind. `GeoIDEvents.markerAt`
  is the feed's one hit test, published, and the viewer's pick and the GIS
  card stand down when it answers. This is the label claim's idiom again: markers draw
  above everything, so a marker's pixel is the marker's. **Do not arbitrate
  with `stopPropagation` on `pointerup`**: OrbitControls needs that event, and
  this file already records the globe latching into rotate without it.
- **Cards in different slots stayed up together.** `card-owner` slots were
  independent, so an event card opened later left an earlier geology card, and
  its outline, on screen. `own()` now closes the other slots' cards through
  their own closers: one card on the globe. Safe because every opener claims its
  slot BEFORE drawing its highlight. A closer that clears the pin cannot wipe
  the highlight of the card that is opening.
- **The geology card's ✕ could not be clicked.** `.geo-popup-scroll` takes the
  pointer back from a card that otherwise lets it through, and it won the hit
  test at the button's centre (`elementFromPoint` there was `.feature-kicker`).
  A real click landed on the kicker, the card stayed, and so did the outline.
  The scene card's ✕ had paid for this exact fault. The fix is `z-index` on the button in all seven
  stylesheets that carry the wrapper. **Check any control over flowing
  content with `elementFromPoint(centre) === control`**; a click test through
  `btn.click()` passes regardless.

**The model page: a part card owns the selection it makes.** Opening a part's
card selected its volume (the red emissive tint), and every close left the tint
standing. `showPartCard` now makes the selection and records it, and `closePartCard`
clears it unless the reader has changed the selection since. Callers no
longer select on their own.

**New model left every face's Workspace layer behind.** It removed the meshes
by hand. It now goes through `deleteEntities` and `renderStudioPoints`, which
take the layers too. Measured: 11 studio layers before New, 0 after.

**A drawn shape with its live overlay still up swallows canvas clicks.**
`captureDrawn` alone keeps the overlay. The draw bar's Done also clears it, and
a probe that captures without clearing will find clicks never reach the canvas
(the click is stopped in capture before the target). Reproduce the user's
flow, not a shortcut through half of it.
## The volcanoes live in Hazards now; UK geology is out of the catalogue

**Geology ▸ Volcanoes merged into Hazards ▸ Volcanic hazards.** The
Smithsonian row is now HOMED in `volcanic-hazards`; it is no longer a mirror, and
`MIRRORS` is empty but kept as the seam. The drawer under the row
(`#volcano-hazard-buffers`, the entry's `settings`) now opens with the old
subtab's labelled **Label detail** slider and caption (`#volcano-detail`,
`#volcano-detail-copy`, still wired by `wireVolcanoDetail`), followed by the
per-type toggles (`#volcano-types`) and then the buffers. The entry sets
`ownDetail`, so `catalogue-list` skips its compact inline slider there: two
sliders for one level would be two controls for one idea. `ownDetail`
is carried in BOTH catalogue projections, the trap this file has paid for
three times. The `geology-volcanoes` home and its host are gone. The earlier
home table's `geology-volcanoes` row is history.

**The two UK geology (BGS 625k) rows left the catalogue**, along with their
group. The `bgs-geology-*` connectors stay in `research/connectors.js` for the
Research Hub. The ground profile's superficial-deposit row now says to import
a superficial map rather than to tick a row that no longer exists.

**Icons:** Soil and surface materials is a hill, Rock properties a rock, and
Volcanic hazards the volcano its merged subtab wore (`TOOL_ICONS`, keyed by the
summary's lower-case title). Tropical cyclones, Seismic hazards and Exposure
still wear the fallback bracket.

**No subtab wears the fallback bracket now.** A sweep found 21 heads on it
(Tropical cyclones, Exposure and Seismic hazards among them). Each has a glyph,
and the painter drops a trailing numeric count from the title before the
lookup ("Surface analysis (21)" is Surface analysis). Only a NUMBER in brackets
is dropped, so "Seismograms (FDSN)" keeps its own key. The planets' "Inspect"
reuses Earth's "inspect and pin". Measured: 82 heads on Earth, 59 on Mars and
50 on Jupiter, with none on the bracket. The regression check is the same
probe: `.gis-tool-section > summary` whose SVG matches the bracket path
`M5.6 3.2H3.4`.
## The icon beside the world's name is the world's

Every planet page wears its own icon beside its title. Earth wore the GeoID
mark, and `earth-viewer.js` re-set it at boot over whatever the markup said.
Both now say `/assets/earth_icon.png`. The GeoID mark itself (the header's)
is untouched, and the theme rule that no skin restyles `.brand-logo` covers
the Earth icon the same way.
## The events button steps left of a workbench, like the legend beside it

With Settings open the legend stepped left across the screen and the events
button stayed where it was. The shared drop-down is placed off both buttons,
so it stayed over the workbench. `placeOverlay` read the rail's offset and
nothing else. The legend's stylesheet uses `max(5.5rem, var(--workbench-w))`
(side-panels.js), and the button now takes the same maximum. It then calls
`GeoIDOverlayStack.reseat()` so the slot follows. `reseat` places the slot
and does not run the one-open rule, because `placeOverlay` also runs on a
one-second poll. Measured before: legend 901 → 534 px, events button 793 px
both times. There was no transition to wait out (0 s).

**And the slot must not step onto the sidebar.** Once the buttons had
followed the legend, the slot's step-left-of-the-clock rule sent the panel to
126–406 px, over a sidebar that ends at 400. That rule was written for a
narrow screen, where there is room to step. `slotFrom` now takes a `floor`,
the sidebar's right edge. It steps left only when the panel then stays clear
of the floor; otherwise it drops below the obstacle and stays under its own
buttons. Where the room between the sidebar and the workbench is less than
the panel's width (243 px for 280 at a 1,091 px viewport), the slot narrows
to fit, down to 200 px. The rows ellipsise, and a narrower panel beats one
lying over the sidebar.
## The tab bars, assessed: what was measured and what changed

Asked whether the nav tab bars' style and structure are optimal. Measured on
the pane (384 px column, 779 px tall) rather than eyed, across all three
pages. What holds up: one idiom per tier on the GIS page (a filled level-1
tab, outlined level-2 cards in the sub-tab voice, one chevron on the left
turning one way), the Model page's deck being the GIS column's own tab in
the same chrome, and the Research rail's banded dock. Three things did not:

- **OPEN AND CLOSED-WITH-DATA WERE ONE LOOK.** A closed tab holding data
  took the solid accent fill with dark ink — exactly what an open tab wears.
  One screenshot: Live Events (closed, armed) and Geology (open) both solid
  magenta, the chevron's angle the only difference. A column that cannot
  say where it is has lost the one thing a tab bar is for. A closed tab
  with data is LIT now (a tint of the accent, a 3 px spine, title and icon
  and chevron in the accent), and the solid fill means open. One loud level
  — the rule `studio-ui.css` already states for the Model page, applied to
  the column it was copied from.
- **THE OPEN TAB'S HEAD SCROLLED AWAY.** Hazards is nine subtabs; a screen
  into it the column showed cards with nothing to say which tab they belong
  to. The open head is `position: sticky` against `#ui-scroll-body`. Two
  traps: a `.control-section` clips its overflow for its corners, and an
  overflow that is not visible is a scroll container to sticky — the head
  stuck inside its own tab, which never scrolls (measured `static` behaviour
  with the rule applied); the OPEN tab lets its overflow show. And the tabs
  sit one wrapper down (`#gis-toolbox-panels`), so the child selector
  matched nothing; descendant. Planets carry the rule in `gis/shell.css`,
  where the id outranks each planet's own `overflow: hidden`.
- **THE WORKSPACE BOX TOOK HALF THE HEIGHT.** Its body is capped at
  `min(42vh, 20rem)`; on a 779 px pane that is 360 px of box against 312 px
  of tab column — three tabs in view, an open tab's first subtab below the
  fold. 30vh now (234 px there), and on a tall screen the 20rem cap decides
  either way. The studio's Visibility box takes the same number, pinned
  equal across both stylesheets.

What was NOT changed, and why: the tab ORDER (Live, Explorer, Map, Geology,
Earth Observation, Hazards, Model Builder, Metadata) is argued in
`toolbox.js` and holds — the case for Explorer first is real (it is "where
am I") and so is the case for Live first (it is on at launch and is what a
visitor sees moving); reordering is a decision, not a fix. Metadata as a
one-subtab tab stays for the reason its comment gives. The Explorer tab's
level-2 sections are a different class from the other tabs' subtabs and
wear the same voice by rule, not by class — measured equal.

Also in this pass: the fluid checklist warns when a time step is thousands
of sound transits of the model (`acousticTransits`: c = 1/√(ρβ) over the
shortest domain height; 75 ran, 75,000 diverged, warn past 1,000, and the
sentence carries a suggested step), and a sweep parameter is named once
("top — Pressure (Pa)", not "Pressure on the face Pressure (Pa)").
## The bar is the home of every pointer tool, and two exports that never met

Reported as the other planet viewers not being up to speed with Earth and
Mars. Measured across all ten worlds in the shell: **four rail items on Earth
and the five rocky worlds, SIX on the four gas giants** — Distance and Profile
extra.

**`draw-hud.js` keyed the WHOLE BAR on `setStudyAreaPolygon`.** The bar carries
Points, Distance and Profile beside the shapes, and all three go through the
ordinary measure path — a real two-click distance on Jupiter reads **54,991.6
km**, a quarter of that planet's own circumference to 0.2%. So a gas giant was
refused the bar because a FOURTH tool could not run, and its rail had to keep
Distance and Profile as their only doorway. It is built wherever one of those
tools is on the page now, and only the half that needs a surface stands down:
the shapes, Custom and Done disabled with the reason, the rail's own Draw
button as before. A mode button is shown against its rail button **on every
refresh** rather than decided at build, because Points is built at runtime and
never on a gas giant.

**EARTH CALLS THE DISTANCE EXPORT `route` AND EVERY PLANET CALLS IT
`distance`** — one occurrence in the tree against nine — so `borrowExport`
looked for a node that is not there and the button stayed in the rail. The
module accepts both spellings rather than the markup being renamed, because
the viewer holds a live reference to that node. **The home marker is keyed by
the NODE'S OWN name**: keyed by the armed mode, a planet's button would be
borrowed and could never find its way back.

**A probe that reads a control before its retry has run reports a fault that
is not there.** `standDownDrawButton` stands the Draw button down at 20 tries
(ten seconds); read at four, it is still enabled with its original title, which
looks exactly like the stand-down never happening.
## One name, one place: the project was on screen three times

The header, the hub's shell chip, and the page header's pill. The header's is
gone outright (the viewer still sends `geoid:context`; nothing draws it), and
the pill went with it: **`pageHeader`'s third argument is a STATUS pill**, and
three callers were passing the open project into it — `spec-page.js`, which is
all 53 tree-rendered pages, plus Data Hub and Projects. Measured with a project
open: the chip at top 6 and the pill at top 49, **both at left 1130**.

What remains is the chip, and on the Projects page its own list row — that
page's whole subject is the list of projects, so the open one being in it is
not a duplicate label.
## The app's own tools sit together in the bar

The project dialog, the playlist and the settings are the APP'S; the three mode
pills after them are WHERE YOU ARE, which is a different question. So the music
and the gear join the project button, and the gear leaves the Workspace box —
which holds a reader's LAYERS — standing down there exactly as the playlist
does. It keeps its place in the page: a standalone viewer draws no header, and
that gear is then the only doorway to Settings. Pressed through the REAL
control, so Settings keeps one implementation.

Measured on **all ten worlds**: the bar reads project, music, settings, modes;
the page's own row, music, audio caption and gear are all hidden; the ⓘ and the
collapse sit with the title; the draw bar is built; the rail is four items —
**one shape, ten worlds**. The only per-world differences left are facts about
the bodies (no recording on Earth or the Moon; no Geology or Sea Level on a gas
giant).

### And an open tab's corners: the CHILD carries the radius

A closed tab clips its children, so its square summary is cut neatly into the
rounded corners. The **open** one cannot — its head is sticky, and a sticky
element inside a clipping box sticks to THAT BOX rather than to the column, so
it was set to `overflow: visible`. With nothing clipping, the summary's square
magenta fill painted over the 11.2px arcs while the 2px border curved around
it. The children round themselves to the parent's **inner** radius instead
(11.2 − 2 = 9.2px, the head taking the top two and the body the bottom two), so
nothing needs clipping and the sticky head is untouched.
## The lock is said before the press: the folder, the Export icon, the Export panel

Saving and exporting are membership's, and the way a free reader found that
out was by opening the folder dialog, typing a project name, pressing Create
and reading an error line at the foot of it. `may("save")` was enforced in
thirteen places and ANNOUNCED in none of them.

**A locked thing is SHOWN and refused, never hidden.** The folder dialog IS
the saving feature — hide its controls and there is a dialog with nothing in
it and no way to find out what it was for. The contrast dropping is the
signal, the padlock is the reason, and that division is what decides where
each mark goes: **a surface with a BODY takes the card; a control that is only
a glyph takes the mark.** The folder button, the Workspace's Export icon and
the Export panel's own button are the three doors on this path, and the panel
behind the icon has a body, so it is the one that gets a card.

**The card is exported, not copied.** `lockCard` and `lockMark` come out of
`feature-locks.js`, so the folder dialog shows the same card a locked tab does.
A second refusal written beside the first is how two gates for one feature come
to disagree — the fault this tree already records for the clip button, the
extraction dialog and the click sound.

**The first action is the one they CAN take.** With the service live, somebody
signed out is one press from the thing being refused, so Sign in leads and
membership follows quietly; somebody signed in and not a member has nothing to
sign into, so membership leads. `may` answers the same either way — the
difference is only in what to offer. The return address is the TOP document's
(`${location.origin}/`), because a viewer is framed and returning to
`location.href` here loads a viewer with no shell around it, and every link is
`target="_top"` for the same reason.

**A button that refuses has nowhere to say why, so these still open.** The
folder button opens its dialog and the Export icon opens its panel; what they
carry is the padlock badge and the sentence, in the tooltip AND the accessible
name. Only the doors that would throw — Choose folder, Keep in this browser,
Create, and the panel's Choose a layer to export — are disabled, and they go
grey with the mark beside them.

**THE HEADER'S COPY IS TOLD BY WATCHING THE BUTTON MUTATE.** The shell draws
its own folder, so the bridge reports `locked` off the viewer's real button
rather than asking the gate a second time in a second document. Both sides
listen for `geoid:membership` and the bridge installs first: on an unlock it
reported the class the button had not changed yet, and the header stayed locked
until the next unrelated redraw. A `MutationObserver` on that button's `class`
and `aria-label` is the fix, guarded by `folder === folderWatched` so a re-host
does not stack observers and double every report.

**`state.project` went from a boolean to an object**, which an older cached
frame survives only because an object is truthy either way — the shell reads
`p.present === false` to hide it.

**A stub element with only a `classList` is not a stand-in for one.**
`mode-bar-bridge.test.mjs` built its fake document with `classList.contains`
and nothing else; the moment the bridge read the button's `aria-label` it
threw `folder.getAttribute is not a function` at import and took all 42 checks
to `0 passed` — this repo's documented signature, hit again. The stub grew
`getAttribute`/`setAttribute`, not a guard in the module.

**`openExportDialog`'s `window.alert` stays.** It is the enforcement, and the
dialog is reachable from `window.GeoIDLayerExport` as well as from the panel.
What changed is that nobody arriving by the button reaches it.

The four measurement CSV exports on the tool rail (distance, area, profile,
points) are NOT gated and are not marked — they write out what the reader just
measured, not what the app computed.
## Toggling a layer is a visibility flip; unticking parks, not destroys

Measured on a 13,102-polygon geology sheet (synthetic MVT, software GL):

| | before | after |
| --- | --- | --- |
| eye on | 1,517 ms frozen | 151 ms first, 20 ms after |
| untick → re-tick | 16 fetches, 3.9 s, a 3.3 s long task | 0 fetches, 1.1 s |
| DEM sheet re-tick | ~1.3 s | ~20 ms |

- **Every visibility change on the page rebuilt geology's click catalogue**
  (`publishInteractive` on `layers-changed`/visibility), and the cost was
  `rockClass` building a RegExp per term per call for every polygon. The
  patterns are compiled once and the answer memoised by text; the catalogue is
  cached per layer, keyed by the feature array, colour field, key, name and
  credit (`CATALOGUE_CACHE`, a WeakMap).
- **Unticking a tiled map PARKS its controller** (`unloadTiledLayer`): the
  group is detached from the record before `removeLayer` so it is not
  disposed, held up to 4 minutes (3 maps at most), and `loadTiled` reclaims it
  if the entry is the same entry (paint, filter, pyramid). The row still goes
  at once. Every tiled unload goes through it: the geology tick and master,
  `removeDerivedGeologyMap` (soil, GLiM, ice, rock properties), hydrology, the
  contacts layer.
- **The DEM's terrain readings park the same way** (elevation, slope,
  hillshade, temperature, pressure), re-attached only over the same view and,
  for hillshade, the same light. The models (sea level, floods, corridor
  zones) carry settings and are always rebuilt.
- The ~700 ms tasks that remain while a sheet is visible are FRAMES on the
  software rasteriser ((program) in the profile, no JS of note) — not a
  toggle cost. Profile before blaming a toggle for a slow frame.

The sandbox reaches neither the bucket nor Macrostrat; measure tiled layers
with synthetic MVT served through `page.route` (an encoder in the shape of
`mvt.test.mjs`'s, a jittered shared-vertex grid with the columns the layer
reads).
## The ⓘ guide explains Earth Engine and projects, and its buttons are the real doors

`#viewer-help-gee` in the Earth guide walks through using GeoID's endpoint,
registering a Cloud project (and its SERVICE ACCOUNT — the project alone fails
on the first request), deploying `services/gee-tiles` (the README's own
command, pinned against it), pointing Settings ▸ Earth Engine at it, the exact
form of an `ALLOWED_ORIGINS` entry, a project folder, and the sidecar.
`gis/gee-help.js` wires four buttons to the controls the text names: the
connection check (`GeoIDGeeCatalogue.check()` — asks this page's own
endpoint's `?list` and says whose endpoint, how many curated collections, and
whether the build resolves Google's whole catalogue), Settings with the
endpoint field focused, the catalogue window, and the project dialog. A door
not on the page is disabled, so the guide cannot point at nothing.
