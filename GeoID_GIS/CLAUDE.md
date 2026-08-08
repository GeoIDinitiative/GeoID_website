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

## Where things actually live

- Runtime manifest: **`earth-manifest.js`** (inline object). `manifest.json` on
  disk is stale and unused.
- Basemap assets resolve to `/GeoID_Earth/assets/…`, shared with the Earth
  Explorer and Moon viewers — do not delete them when swapping a layer out.
- The Analysis Hub is in the **shell** (`myGeoID/index.html`), not the viewer.
  Opening it shrinks the iframe to ~400px, which trips
  `@media (max-height: 560px) and (orientation: landscape)` in `styles.css` —
  that block restyles `#ui` (narrower, 0.5rem inset, z-index 20) and anything
  positioned relative to the panel must be given matching overrides there.

## Cache-busting

Every `gis/*` import carries `?v=<stamp>`; bump it on **every** edit or the
browser serves stale ES modules. `myGeoID/index.html` carries its own
`?v=gis-<stamp>` on the iframe src. Never version `../vendor/three.module.js` —
`earth-viewer.js` imports it unversioned and a second copy breaks class
identity.

## Verifying

There is a headless-Chrome + CDP harness (`shoot.py` in the session scratchpad):
it drives `http://localhost:8125/myGeoID/`, runs a setup script inside the
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

The store writes through `gis/research/fs-adapter.js` rather than to
`FileSystemDirectoryHandle` directly, because `showDirectoryPicker` needs a
native dialog no headless browser can drive. `memoryAdapter()` stands in for
tests: `store.useMemoryAdapter()` then everything downstream of the picker is
the real code path.

**Bridge contract** (`gis/research/bridge.js`) — what makes the three pages one
workspace:

| from | to | what |
| --- | --- | --- |
| GIS Area tool | `study_area` + `metadata/study_area.geojson` | `captureStudyArea()` |
| import-manager | `data/raw/` + `metadata/data_registry.json` | `registerImportedLayer()`, called on every completed import |
| extraction | `exports/` | `saveExport()`, called from `downloadText()` |
| Meshing Studio | `meshes/` | `saveMesh()` |
| project | globe camera | `frameStudyArea()` |

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

Pages register into `gis/research/stages.js`; the twelve stages mirror the Qt
`base_stage_structure` and must not drift from it. An unregistered page renders
a labelled "not built yet" panel — do not replace that with a plausible-looking
empty form.
