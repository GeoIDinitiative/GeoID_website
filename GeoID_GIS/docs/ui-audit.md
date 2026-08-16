# GIS UI audit — cohesion, gaps, and what the architecture should be

Written 2026-08-16 against `gis-viewer-mygeoid`. Every number here was
measured, not estimated; the commands are given so they can be re-run.

---

## 1. What the architecture is *for*

The project's aim is one workspace where a question about a place is answered
end to end: **map it → query it → analyse it → model it → write it up**, with
the same objects throughout. That gives the architecture its shape:

| layer | what it is | the rule |
| --- | --- | --- |
| **The spine** | the layer list (`import-manager`) | everything visible is a layer, whatever made it |
| **The verbs** | the tool registry (`TOOLS` in `tool-runner`) | one descriptor per operation, one dialog, one runner |
| **The surfaces** | GIS sidebar · Analysis Hub · Studio · Research Hub | each *shows* the spine; none owns a private copy |
| **The record** | the project folder | anything worth keeping lands there with provenance |

Read that way, most of the incoherence has a single cause: **things that
should be on the spine are held privately by whichever surface created them.**
Everything in §3 is a variation of it.

---

## 2. What is actually there (measured)

### 2.1 The sidebar

Eight top-level groups, identical ids on both sidebars:

```
gis-group-modelled     Earth Engine            2 sections
gis-group-import       Add / Import Data       1
gis-group-polygons     Shapefiles              0 nested — one file input and a list
gis-group-preprocess   Pre-processing Toolbox  9
gis-group-analysis     Extraction & Analysis   6
gis-group-export       Export Data             2
gis-group-metadata     Metadata                1
gis-group-layers       Layer Hierarchy         10 on Earth, 0 on the planet shell
```

The tool rail carries **three** tools (Distance, Draw, Profile). The planet
pages wrap the same groups in side panels (`gis-side-panel-*`), one per rail
button; Earth stacks them in a single scrolling sidebar. **Two markup files
express one design** — `viewer/index.html` and `viewer/gis/shell.html` — and
they are edited by hand in lockstep.

### 2.2 Coverage

```
78 modules under viewer/gis/, 40 with tests
```

Untested (39): `analysis-panel · atlas-assistant · batch-panel · bodies · boot ·
charts · demo-layers · events · gee · georeference-panel · geotiff-adapter ·
import-manager · layer-export-dialog · layer-hierarchy · layer-properties ·
mesh-formats · mesh-primitives · mesh-volume · model-studio · mode-manager ·
msh-adapter · panel-styles · planet-strip · polygons · project · search-text ·
shapefile-adapter · shell · sidecar-client · side-panels · stl-loader-adapter ·
symbology-panel · tile-sources · toolbox · toolbox-ops · tool-dialog ·
tool-runner · vector-formats · vector-render · xyz-adapter`

The split is exact and damning: **the analysis core is well tested and the UI
layer is not tested at all.** Every fault reported in the last week —
catalogue in the wrong panel, styles on the wrong page, a dead select, the
dialog that built itself invisibly — lives in that list.

### 2.3 The pipeline

The seams exist and have callers:

```
captureStudyArea      bridge, research/dashboard, research/projects
registerImportedLayer import-manager, bridge
saveProcessed         tool-runner, bridge
saveMesh              extraction, model-studio, bridge
sendToStudio          model-studio, bridge, research/projects
restoreLayers         project, tool-runner, bridge
frameStudyArea        bridge, workspace, dashboard, projects
```

So GIS → project → Studio → Research is connected in code. What is missing is
**visibility**: nothing in the GIS sidebar shows the project's state, so from
the map you cannot see what has been captured, processed or sent.

---

## 3. Findings

Ordered by how much cohesion each one costs.

### F1 — Drawn geometry is not a layer *(the example you gave)*

The Draw tool hands its polygon to the viewer's `activateStudyArea`, which
keeps it in viewer state as the study area. `polygons.js` — the Shapefiles tab
— lists `GeoIDImportManager.getLayers()`. The two never meet, so a polygon you
drew is invisible to the layer list, to every tool's input select, to export,
to symbology and to the project registry.

It is also the clearest instance of the general fault: geometry the user made
by hand is the one kind of geometry the spine does not carry.

**Fix:** on completing a draw, register the polygon as an ordinary vector
layer (`addDerivedLayer`, ext `drawn`) *as well as* setting it as the study
area. Then rename the group **Vectors & Shapes** and let it list all vector
layers with their source (drawn / imported / derived). One change makes drawn
areas clippable, bufferable, exportable and restorable for free.

### F2 — Zoom floor depends on what kind of layer you loaded

`basemap-drape.js:hasDrape()` returns true for: a `tiles` layer, an imported
**raster** with an extent under 20°, a `tiles-` basemap, or the refine patch.
There is no vector case. Measured consequence: load the NI **susceptibility
raster** and the camera reaches ~1.8 km; load the NI **geology polygons** —
the same country, the same scale — and it stops at ~995 km.

**Fix:** qualify on the layer's *extent*, not its type. A local vector layer is
local data and should lower the floor exactly as a local raster does.

### F3 — The group names describe history, not contents

- **"Shapefiles"** holds one file input; it accepts GeoJSON, KML, GPX, WKT and
  CSV through the same path.
- **"Pre-processing Toolbox"** holds Attribute Table, Query syntax and
  Attribute Query — reading and selection, not pre-processing.
- **"Extraction & Analysis"** now holds Symbology, which is display.
- **"Modelled Data"** is titled *Earth Engine* in the markup.

Every misplacement I have made in this project was a symptom of this: with
names that do not partition the work, "where does this go" has no answer and
the nearest anchor wins.

**Fix:** name the groups after the user's verbs and make the set exhaustive —
**Data · Style · Analyse · Model · Export · Project**. Anything that does not
fit one of six verbs is a sign the feature is not understood yet.

### F4 — Earth and the planets are two files for one design

`index.html` and `gis/shell.html` carry the same panels, edited by hand. They
have already drifted: Layer Hierarchy holds ten sections on Earth and none on
the planet shell. The styling split (`styles.css` vs `shell.css`) caused the
unstyled panels last week and is only half-solved by `panel-styles.js`.

**Fix:** one source. The panel markup becomes a module that renders into a
host, the way the tool catalogue already builds itself from `TOOLS` — at which
point Earth and the nine planets cannot differ except where a body genuinely
differs.

### F5 — The UI layer has no tests

See §2.2. The pattern is that faults are found by you, in a screenshot, after a
commit that claimed verification.

**Fix:** a `tests/ui.py` pass that asserts *structure*, not pixels: every
registered tool appears in the catalogue; every panel id in the markup has a
module that reads it; the two sidebars expose the same ids; every `<select>`
that a handler reads is populated; nothing overflows its panel at 300 px. Each
of those would have caught a specific fault from this month.

### F6 — Nothing in the GIS shows the project

The bridge writes to the project on import, extraction, processing and
meshing, and the Research Hub can see all of it. The GIS sidebar cannot: no
project name, no study area, no "3 datasets, 1 mesh, 2 runs", no way to open
what the last tool produced.

**Fix:** a **Project** group at the top of the sidebar — name, study area with
a Frame button, counts by kind, and the last five things written. It is the
one panel that makes the three surfaces feel like one application.

### F7 — Two conventions for "where does output go"

`runToolAuto` adds a derived layer *and* writes to `data/processed/`.
`extraction` downloads a CSV *and* writes to `exports/`. `model-studio` writes
meshes to `meshes/`. Georeferencing and symbology write nothing. A user cannot
predict whether a result is on the globe, on disk, in the downloads folder, or
all three.

**Fix:** one rule, stated in the UI: *every tool produces a layer; every layer
can be saved to the project; nothing is written to disk without being a
layer first.*

### F8 — The sidecar's remaining role is undocumented in the UI

No tool in the catalogue needs it now. It is still required for GALES, gmsh,
arbitrary scripts and model keys — all Model/Research surfaces. The GIS shows
no trace of it, which is right, but the Model pages do not say plainly that
those four things are why it exists.

---

## 4. The cohesion plan

Sequenced so each step is independently shippable and each makes the next
easier.

| # | Change | Cost | What it buys |
| --- | --- | --- | --- |
| 1 | **Drawn polygons become layers** (F1) | S | The spine is complete; Draw joins every tool's input list |
| 2 | **Zoom floor by extent, not type** (F2) | S | Every local layer behaves the same at every altitude |
| 3 | **Project group in the sidebar** (F6) | M | The three surfaces read as one application |
| 4 | **Six verb-named groups** (F3) | M | "Where does this go" has an answer, for me as well as the user |
| 5 | **Structural UI tests** (F5) | M | The faults you have been finding get found before the commit |
| 6 | **One panel source for ten worlds** (F4) | L | Drift becomes impossible rather than unlikely |
| 7 | **One output rule** (F7) | M | Results are predictable and always recoverable |

### Status, 2026-08-16

| # | State |
| --- | --- |
| 1 Drawn polygons are layers | **done** — registered on draw, deduplicated by shape, area computed from the ring |
| 2 Zoom floor by extent | **done** — `hasDrape()` qualifies any local layer; verified false → true on a drawn box |
| 3 Project group | **done** — name, study area, counts by kind, last five writes, each a button back to the globe |
| 4 Verb-named groups | **done** — Project · Data · Analyse · Style · Export, and the Attribute Table and Query panels moved to Analyse |
| 5 Structural UI tests | **done** — `tests/ui.py`, 12 checks on Earth and Mars; found the `GeoIDLayers` seam bug on its first run |
| 6 One panel source | **not started** — see below |
| 7 One output rule | **partly** — georeferencing and drawn areas now record to the project like tool output; the remaining gap is a per-layer "save to project" for anything imported |

**Why 6 is still open.** Unifying the two markup files means moving every
panel into a module that renders it, for ten viewers, in one change — and the
thing that made that change safe (the structural tests, step 5) only started
existing today. The tests now assert id parity between the two files, so drift
is caught rather than discovered; that lowers the cost of doing 6 properly
later and removes the reason to rush it now.

Steps 1 and 2 are hours, not days, and they are the two you named.

---

## 5. What "user friendly" means here, concretely

Three rules the current UI breaks and the plan restores:

1. **Everything you can see is on the spine.** If it is on the globe it is in
   the layer list, and if it is in the layer list every tool can take it.
   (Broken by F1.)
2. **The same data behaves the same way.** Two layers over the same country
   have the same zoom limits, the same symbology controls, the same exports.
   (Broken by F2.)
3. **A panel's name predicts its contents.** Six verbs, exhaustive, no
   overlap — so a new feature has exactly one place to go. (Broken by F3, and
   the direct cause of three misplacements this month.)
