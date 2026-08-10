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

**Known limit: you cannot yet zoom in far enough to see it.** The render loop
pins the camera to `_safeMin` (3.7, about 1000 km up), which is right for an
8 km/px basemap and wrong for 15 m/px imagery. Lowering it the way the viewer
already does for Mars CTX tiles was tried and **reverted**: `controls.minDistance`
did drop to 3.316 and the camera still stopped dead at 3.7, so a third clamp
exists beyond the two `setLength(_safeMin)` calls. `hasDrape()` is left in place
for whoever finishes it, along with the one trap found: it must not be
conditioned on layer *visibility*, or switching the layer off moves the camera
(measured: 71% of the frame's pixels changed).

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
