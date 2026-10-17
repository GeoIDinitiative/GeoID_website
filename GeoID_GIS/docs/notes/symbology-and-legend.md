# Symbology and legend

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

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
## Symbology survives a round trip once BOTH ends stop lying

"The symbologies and legend entries are not preserved when a clipped geology
layer is exported and imported back." Two faults, one on each side of the trip,
and the second only became visible once the first was fixed.

**A shapefile carries no symbology, so this app writes a `.qml` beside it —
and the import ignored it**, reconstructing the colouring from the attribute
table. That works while the colour column is complete and collapses when it is
not: back to the twelve-class ramp with an `(other)` bucket. `parseQml` reads
the style file (plus `parseQmlWithoutDom` for Node, safe because the writer
escapes its quotes), `buildVectorLayerResult` takes a `style`, and
`styleSymbology` **outranks everything inferred** — the file names the column,
every category and every colour, so nothing has to be guessed.

**Then the two keys still disagreed, and the SOURCE was the wrong one.**
`dropOutranked` removes every coarse polygon a finer survey maps in full, and
the colour inheritance read `fc.features` — the set BEFORE that cut. Measured
on a 52 km clip: the card claimed **"12 of 27 units" over a layer holding 23**,
and four of its twelve rows named regional units that had been dropped
("Cenozoic volcanic rocks", "Mesozoic sedimentary rocks", "Paleozoic
sedimentary rocks", "Precambrian-Phanerozoic crystalline metamorphic rocks").
Those ghosts took four of the twelve places, so four units that ARE on the map
had no row.

That is why it presented as the round trip losing the legend: an export carries
the FEATURES, so a re-import's key lists the units that are really there and
disagrees with the source's. The sidecar path had read `out.layer.features` all
along for exactly this reason; the native path now does too, and the result
message counts the layer's own features rather than the fetch's.

Measured after, source against re-import: **127 / 127 features, labels
identical, palettes identical, both "12 of 23 units", zero ghost rows, no
`(other)`, no ramp colours.**

Two things worth keeping from the way there:

- **The threshold was wrong twice.** Requiring EVERY feature to carry a hex,
  then four fifths, both sent a whole layer back to the ramp over a handful of
  blanks. `color`/`colour` holding hex are unambiguous and are believed past a
  fifth of the rows; `fill`/`hex` are guesses at intent and keep the strict bar.
- **The fault is which VARIABLE is passed, and both are FeatureCollections** —
  a wrong answer and a right one look identical at runtime, which is the same
  shape as `GP.difference` returning the subject whole. `verbatim-units.test.mjs`
  pins it on the SOURCE: no inheritance call may read `fc.features`, and the
  native one must read `shown.features`. Verified by reverting the line and
  watching the check fail.
## A layer that says what colour it is

A 47 km Macrostrat clip exported to GeoJSON and to shapefile and re-imported
came back whole — 97 of 97 features, every `COLOR` cell intact — and read as a
different, broken map: painted in this app's qualitative ramp (#E05859,
#4F78A6, #F28D2F where the survey said #FF9BCD, #EBEBEB, #7FC64E) under a key
that was a smooth gradient bar naming nothing. Reported as "missing polygons on
the left" and "the categories are not registering — no differentiation". Two
separate faults wearing one costume:

- **The colour column was never asked for.** `buildVectorLayerResult` always
  classified by `suggestCategoryField` + `categoricalSymbology`. It now prefers
  a column the file itself publishes (`color`/`colour`/`COLOR`/`fill`) when it
  holds a valid hex on EVERY feature — `inheritedColouring`'s rule, because a
  partial column paints half the map from the file and half from a ramp. Where
  the invented colour landed pale, ground read as absent; that is the whole of
  "missing polygons".
- **The legend never declared itself a class list.** The dock draws
  `legendInfo` as a continuous ramp unless `classed` is set, and this was the
  one producer here that never set it — macrostrat.js, symbology.js and the
  symbology dialog all do. Every classified vector import, not just this round
  trip, had its rows fall through to the gradient branch.

`import-manager` records the column as `sourceColourField`, so a clip OF a
re-imported map inherits it; without that the round trip was faithful on screen
and reverted to a ramp the moment it was cut.

**`inheritSourceColours` is fire-and-forget, so a layer read the instant
`runToolAuto` resolves has NOT got its inherited legend yet.** Measured the
clip output twice as `sourceColourField: null` with a Tableau palette, called
it a regression, and reverted a working change on the strength of it. Read the
layer a few seconds later, or read it after the repaint lands. Same family of
mistake as measuring coverage before the tiles finished loading.
## "Imports as one colour" was the style, not the data

Assessed before changing anything, with `ogrinfo` on the exported 10 km clip:
**8 of 8 features carried a NAME and a COLOR**, six distinct units, six distinct
colours — "Argyll Group" / "marble, meta-limestone" / #FF9BCD, and so on down
the table. Nothing was lost in the export.

A shapefile cannot hold symbology. QGIS therefore opens one in a single
arbitrary fill with the file name for a legend: everything the reader needs is
in the file and nothing tells the reader to use it.

The bundle now carries **`<basename>.qml`**, which QGIS loads beside the layer
without being asked — a categorised renderer on the unit's own column, each
category taking the colour the survey published. **`.sld`** goes with it for
readers that will not take a QML. Written only when the layer can say what
colour it is; inventing a palette in the export would be a different map from
the one on screen.

Two details decide whether it works at all:

- The style matches on the **DBF column** (uppercased, ASCII, cut to ten
  characters) while the values are read from the **property**. Confusing them
  produced a style that matched nothing and silently shipped no file.
- A unit name is user data. `Sand & Gravel` unescaped closes the attribute
  early and the document stops being XML.

Verified from the UI's own export: members `shp shx dbf prj qml sld cpg`,
`attr="NAME"`, six categories, labelled by unit.
## A streaming layer has to be told about opacity

The world geology now lands at 50% (`initialOpacity` on the dataset, applied
only in the branch that CREATES the layer, so a rebuild carries across whatever
the reader set instead).

Setting it surfaced an older bug. `layer-hierarchy.setOpacity` traverses the
objects that exist when it runs; a tiled layer builds more whenever the view
settles, each from the opacity the CONTROLLER remembers. So a sheet dragged to
90% kept handing new tiles the value it had on load — measured, **16 objects at
0.9 and 2 still at 0.5**, permanently, because nothing revisits a tile once it
is built. `setOpacity` now tells the controller too, the way the geology panel
already does on a rebuild. After: 27 objects, all 0.9, no stragglers.

It predates the half-opacity default — the stragglers were simply fully opaque
among faded ones, which reads as a patch of stronger colour and is easy to
blame on the data.
## One uncoloured unit must not cost the others their colours

The published-colour rule demanded that EVERY feature carry a valid hex, on the
reasoning that a partial column paints half the map from the file and half from
a ramp. The alternative turned out to be worse, and it is what happened:
measured on a re-imported clip, blanking **one colour of 96** sent the whole
layer back to this app's twelve-class ramp with an `(other)` bucket, classified
on whatever column `suggestCategoryField` liked — which is why a re-import
appeared with lithology labels and unassigned polygons.

| | colour field | legend | classes |
|---|---|---|---|
| all 96 coloured | `COLOR` | by unit | 12 |
| one blanked, old rule | **null** | app's ramp | 13 incl. `(other)` |
| four blanked, new rule | `color` | by unit | no `(other)`, one grey row |

The column is used when it covers **four fifths** of the features; the rest are
drawn in a neutral `#8a8a8a` with a row of their own saying "No colour
published". Painting most of a map as its survey painted it and admitting the
remainder beats inventing colours for all of it. Below the threshold the column
is still ignored — a stray `fill` on a tenth of the rows would otherwise grey
out the other nine tenths — and the grey row appears only when something is
drawn in it.
## A key that lists twelve of eighteen has to say so

A named polygon looked like it had no legend entry. It had one — the key simply
stops at twelve rows, and unlike the clip's own card it said nothing about it.
Measured on a re-imported 47 km clip: **18 distinct units, 12 rows, six units
absent** with nothing to explain them (Mercia Mudstone Group, Lias Group,
Middle Triassic claystone).

Two changes, both borrowed from `legendFrom`, which had already learned them:

- `legendSummary` — "12 of 18 units" — set on any layer whose key is a summary,
  so the card carries the same sentence the clip's own has always carried.
- The twelve are the twelve largest **by ground**, not the twelve that arrived
  in the most pieces. When `legendFrom` was first fixed, ranking by count sent
  572 km² of mapped ground into the unlisted remainder. Ranking by area also
  promoted the very unit that prompted this report — "Unnamed Extrusive Rocks,
  Palaeogene" went from outside the list to third.

Note `(other)` is NOT this. That bucket belongs to `categoricalSymbology`, the
ramp path, and seeing it means the published-colour path did not fire at all —
check the colour column's coverage first.

### The colour-coverage threshold, twice wrong

| coloured features | column used | `(other)` | grey row | ramp colours |
|---|---|---|---|---|
| 100% | COLOR | no | no | 0 |
| 70% | COLOR | no | yes | 0 |
| 50% | COLOR | no | yes | 0 |
| 30% | COLOR | no | yes | 0 |
| 10% | none | **yes** | no | 4 |

Requiring EVERY feature to carry a hex was wrong; requiring four fifths was
still wrong. Both times the penalty was identical — the whole layer reverts to
the twelve-class ramp with an `(other)` bucket, a different map from the one
the file describes.

`color` and `colour` holding hex values are not ambiguous, so they are believed
once they are more than vestigial (a fifth of the rows). `fill` and `hex` are
guesses at intent and keep the strict bar, because a leftover `fill` on a
handful of rows would grey out the rest.

**`(other)` in a key means the published-colour path did not fire at all.** It
is never produced by the published path — check the colour column's coverage,
not the legend.
## How strongly a layer LANDS is decided by what it draws

A filled area is a claim over ground: at full strength it hides the map it was
loaded to be read against, which is the ordinary reason anybody loads a second
layer at all. A dot is a few pixels wide, it hides nothing, and fading it only
makes it harder to see. So **areas open at half and marks open solid**, and the
rule is `gis/layer-opacity.js` rather than a number typed into each panel that
happens to load something — the world geology had carried `initialOpacity: 0.5`
alone for months while every other polygon sheet landed opaque.

**It only ever FADES, and that is structural rather than a preference.**
`setOpacity` SCALES what an element was drawn at and only the contact seal
records a weight of its own (`baseOpacity`), so the line buffer — built at 0.9 —
is PROMOTED to full by any call setting a layer to 1. The default for everything
that is not an area is therefore exactly 1 and the caller returns rather than
setting it, which also means an untouched layer behaves exactly as it did before
this existed.

**Three things it refuses to call an area**, each a worse map if faded:

- **An OUTLINED polygon layer.** A drawn study area is polygons and is drawn as
  an edge; the whole point of the outline mode is that it covers nothing.
- **A raster.** Half a picture over a basemap is two maps averaged rather than
  one map read.
- **A layer with no features in hand.** A tiled layer's `features` is a snapshot
  and is routinely EMPTY at the moment it registers — measured before now, a
  GLiM layer reporting nothing while its tiles held half a million polygons.
  Guessing there would fade some sessions and not others, so a tiled sheet
  states its own on its catalogue entry and `addDerivedLayer` takes an
  `opacity`. `loadDerivedGeologyMap` defaults it to `AREA_OPACITY` because every
  map made through that door today is a filled sheet; a derived LINE map must
  pass 1, the way the contacts-and-faults dataset does.

### A REPAINT REBUILDS EVERY MATERIAL, so the opacity has to be put back on

This is what made the rule look broken rather than a subtlety: the polygon layer
reported `opacity: 0.5` over fills measured at **1**. `repaintVector` replaces
every child of the group with freshly built materials at their BUILD weight, and
a filled layer's fills are built a tick after the import (the two-pass build) —
so the fade was applied to a group that did not yet hold the meshes it was for.

The same fault was already reachable by hand and nobody had hit it: fade a sheet
to 40%, re-class it in the symbology dialog, and it came back solid under a
slider still reading 0.4. A vector layer now carries `applyOpacity` — it records
the value and re-applies it after each rebuild — exactly as a tiled layer's
controller is told for the tiles it has not built yet. `paintOpacity` in
`layer-opacity.js` is the ONE implementation both the slider and the repaint go
through, so the never-switch-blending-off rule and the scale-don't-replace rule
cannot drift between them.

**And the Add-data dialog was sending 0.85 on every import** — a number nobody
chose, applied to everything, and the one door where a point cloud landed faded
and an area landed nearly solid. The slider opens where the rule says the file
will land and its value is sent ONLY once it has been moved, so the importer
reads the geometry it actually built, which is the only thing that knows a
polygon from a line. Its 0.85 was also load-bearing by accident: `xyz-adapter`'s
own note records that a point cloud only ever drew because that default kept it
in the transparent pass.

`applyImportSymbology`'s opacity now goes through `setOpacity` too. It had
`m.transparent = opacity < 1` — the documented landmine, which turns blending
OFF at 1 and takes a touch-tight point cloud out of the drawn frame entirely —
and its "not repaintable" guard sat ABOVE the opacity, so the one property that
applies to every kind of layer was skipped for the one kind that has nothing
else, leaving the row's slider reading 1 over a cloud the adapter had faded.

Measured live, layer row against the materials it stands for: a polygon import
0.5/0.5, a points CSV 1/1 (still transparent, so still drawn), lines untouched
at their own 0.9, an outlined derived layer untouched, a stated 1 left at 1. The
tiled sheets: soil 24 fills at 0.5 with 24 seals at 0.275, GLiM the same, the
RGI glaciers 0.5 with seals at 0.25, and the contacts-and-faults line layer
still 0.9 with nothing set. A repaint, a re-class and a slider drag to 0.2 all
keep what the layer is wearing.

**`node --check` PASSED a file with a real syntax error**, again — this file
already says it is not a parse check and it was believed anyway. A splice left
two stray `});` lines in `layer-hierarchy.js`, `node --check layer-hierarchy.js`
exited 0, and `node --input-type=module --check < layer-hierarchy.js` named the
line at once. Use the second form; the suite (which imports every module) is
still the thing that settles it.

**The R2 bucket's CORS allowlist admits `http://localhost:8125`, not 8123.** The
tiled sheets cannot be verified on the ordinary dev port — every tile fails with
no `Access-Control-Allow-Origin` and the layer draws nothing, which reads as a
broken layer. `.claude/launch.json` carries a `geoid-bucket-origin` entry on
8125 for exactly that.
## A card that borrows a highlight has to give it back

"When we X out of the popup descriptions the selected line should deactivate
and the highlight shouldn't linger." Reproduced first try on a plate boundary:
card hidden, `GeoID-FeatureOutline` **still visible and still pulsing**, with
no card left anywhere to say what it belonged to.

**The outline is kept ON PURPOSE, and that is the whole mechanism.** When the
viewer's card takes a click, `feature-popup.js` calls `hidePopup({ keepOutline:
true })` — deliberately, because on a map of hundreds of polygons the card
alone cannot say WHICH one answered. What was missing is the other half:
nothing ever handed the outline's life back, so every way of closing that card
left it standing.

`closeGeoPopup` clears it now, and **the close function is the right place
rather than the button** — ✕ is one of FOUR ways this card goes away (Escape, a
pointerdown outside it, and another card opening are the others), and a
highlight that survives three of them is the same bug wearing a different
gesture. `closeScenePopup` already followed exactly this rule for its own flash
label; the geology card simply never did. Verified on all three reachable
paths: ✕, Escape and a click on the sky each leave `w.__marks()` empty.

**And the ordering had to be checked, not assumed.** The risk in clearing on
close is clearing a highlight that was just drawn — but `openGeoPopup` calls
`closeScenePopup`, NOT `closeGeoPopup`, and `showViewerCard` draws the outline
AFTER the card opens. Measured: with a card and a highlight up, opening the
card for another feature leaves the outline standing.

It reaches the five rocky worlds too — they carry their own `closeGeoPopup` and
load the same `feature-popup.js` from `boot.js`. The four gas giants have no
geology card at all. Note the glob trap this file already records: name the
file (`$p-viewer.js`), because `planet_explorer/*/viewer/*-viewer.js` matches
more than one per folder and the extra copies are not the live ones.

### Measuring a click on a thin line, and the false regression it produced

Two candidate points read as "the highlight was lost when I selected a second
feature" and **both were missed clicks**, not a regression — a plate boundary
is a one-pixel line and the projection near the limb is least forgiving. What
settled it was clicking the FIRST of the two on its own and finding it selected
nothing either.

The reliable way to aim: ask the app's own `featuresAt` whether a lat/lon
resolves before clicking it, take only points well inside the disc, and convert
through the iframe's offset — screenshot coords are
`(x, y + iframeTop) * shotWidth / topWidth`, which here is 800/1526. And when
a mouse test says a fix regressed, **run the control that reproduces the setup
before believing it**.
## A stored list of what is ON cannot see a source added later

"Ensure that all live event elements are active upon launch." Every one of the
16 sources is already `defaultOn`, and on a fresh browser all 16 open. The
fault only shows for a RETURNING reader, which is everybody who has used the
page: measured with a set stored before the flood and severe-storm rows
shipped, the whole **Storms and water group came back off** — the GDACS floods,
the EONET floods and the severe storms, which is the cyclone markers — on a
page nobody had touched.

**A stored ON-list is a record of what EXISTED when it was written.** A source
added since is simply absent from it, which reads as "switched off" and stays
off for ever. That is the EONET-split migration's fault in its general form:
the split RENAMED a source and was migrated by hand, and it was noticed;
ADDING one needs no rename and so was never noticed at all.

**What is remembered is now what was switched OFF.** An off-list holds
decisions somebody actually made, and anything not in it — including every
source written next year — is on. Same shape as `LAUNCH_OFF_KEY` for the
catalogue's launch defaults, and for the same reason. `sourcesOff(enabled)`
computes the complement so the storage shape has one owner and `events.js`
never builds it by hand.

- **A NEW KEY** (`geoid-gis:event-sources-off`), not the old one reused: a page
  served from cache mid-deploy would otherwise read an off-list as an on-list
  and switch off exactly the feeds it names.
- **The legacy on-list turns everything on, ONCE.** In that format a missing id
  means "switched off" OR "did not exist yet" and nothing stored tells them
  apart. Reading it as a decision is what kept new feeds dark; reading it as
  all-on costs at most one re-tick of something genuinely unwanted, and from
  the next write the off-list records it properly. The old key is removed on
  the way past, so the ambiguity is answered exactly once. This supersedes the
  one-row EONET expansion, which was this same repair written narrowly for one
  rename.
- **The rule it must not break still holds**: an explicit off is still
  remembered. Verified — unticking Drought writes `["eonet-drought"]`, it is
  still off after a reload, and re-ticking clears the list.

Verified end to end on the stale set that reproduced it: **22 of 22 rows on,
the legacy key retired.** (22 rather than 16 because the six group masters are
tick boxes too — count SOURCE rows, or a correctly-indeterminate group master
reads as a feed that failed to come on.)

**The general rule.** Any preference stored as "the things that are on" goes
stale the moment the set it was drawn from grows. Store the exceptions.
## A single-symbol layer keys itself in its own head

A layer with no palette wears one symbol everywhere, so the legend card's head
and the stand-in row beneath it were saying the same thing on two lines — and
the only thing the second line ADDED was a feature count. "241 lines" is not a
key: a legend row says what its swatch is a swatch OF, and a count is a fact
about the layer that its own Workspace row already carries. That has now been
reported twice; the first time it was the whole row's text beside a colour it
did not describe.

The swatch moves into the head and the row goes, so the card is one line —
mark, then name. **A GRADED layer is untouched**: its classes below carry their
own swatches and their own names, and a mark beside the title would be a colour
describing none of them. Verified: the plate boundaries card is one 56 px row
with an `is-line` swatch 12 px in and centred to 0 px, no `.legend-symbol-row`
at all; the cyclone risk card beside it still draws its six class rows with no
swatch in its head.

Three things that had to be checked rather than assumed:

- **The card's identity does not come from the row.** `titleOf` reads
  `dataset.legendKey` first, which is the layer name, so dropping the label
  cannot collapse two cards into one — which is the fault `symbolLabel`'s own
  comment records paying for (coastlines, rivers and a raster all keyed as
  `symbols:layer`).
- **The shape rules carry a `margin-top`** tuned for a mark sitting beside
  stacked copy. In a centred flex head that pushes it off the line, so it is
  undone for a swatch inside the head — and the mark takes `flex: 0 0 auto`, or
  a long dataset name wrapping squeezes it.
- **The "display only" note moved rather than vanishing.** It lived inside the
  row that no longer exists, and it is where somebody wondering why no tool
  will take a layer looks.

The basemap card is built elsewhere (`basemapCard`) and still carries its own
row — "streamed tiles" plus the licence — which is a type and a condition
rather than a count, so it is left alone.
