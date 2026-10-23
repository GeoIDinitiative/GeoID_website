# GeoID_GIS — working notes

Facts that are expensive to re-derive and easy to get wrong. Everything here has
been verified in the browser, not inferred.

**This file is the INDEX.** It was 1.4 MB (~328k tokens, 286 sections) and loaded
into every session that touched GeoID_GIS/. The sections now live, verbatim and
in their original order, in `GeoID_GIS/docs/notes/<topic>.md` (table below).
Read the one the graph or the table points you at, not all of them.

## Ask the code graph first

The repo is mapped at `~/GeoID_webpage_v1/graphify-out/graph.json` (refreshed by
the post-commit and post-merge hooks; run `graphify update .` by hand for
uncommitted work you are about to query). Before grepping or opening files:

- `graphify explain "<file or symbol>"` — what it is, who imports and calls it, file:line
- `graphify affected "<symbol>"` — everything a change to it touches
- `graphify path "<A>" "<B>"` — how two parts connect
- `graphify query "<question>"` — the broad, noisier fallback

Then read only the code it names, and the matching note below. To find a note
section by subject: `grep -n "^## " GeoID_GIS/docs/notes/*.md`.

## Rules for every change

- **Stamp after editing anything under `GeoID_GIS/viewer/`:**
  `python3 GeoID_GIS/services/stamp.py`, and `--check` must say uniform. Never
  edit a `?v=` by hand. A split stamp silently duplicates modules (identity is by
  URL). Never version `../vendor/three.module.js`. The stamp is the git sha, so
  commit before you verify, or the browser serves the cached copy at a reused URL.
  (foundations.md, "Cache-busting")
- **A backtick inside a CSS template literal ends the string** and silently kills
  the module. `node GeoID_GIS/viewer/gis/module-css.test.mjs` catches it.
- **Tests before the commit:** `node GeoID_GIS/tests/run.mjs` (every
  `*.test.mjs`). On a fresh checkout run `python3 GeoID_GIS/tests/fetch-test-data.py`
  and `npm ci --prefix GeoID_GIS/services/gee-tiles` first. Also
  `python3 GeoID_GIS/tests/sidecar.py` and `python3 GeoID_GIS/tests/smoke.py`.
  (foundations.md, "Running and testing"; GeoID_GIS/tests/README.md)
- **Page policies:** `python3 scripts/csp.py --check` after touching an inline
  script; `scripts/social-cards.py`, `breadcrumbs.py`, `noindex.py --check` run in CI.
- **Run the site:** `python3 serve.py` from the repo root, then
  http://localhost:8125/ (not 0.0.0.0, not another port).
- **Verify in headless Chrome against the EMBEDDED page**, with a fresh profile
  per run. The globe spins on wall-clock UTC, so runs are not pixel-comparable.
  Read coordinates from `#cursor-readout`. (foundations.md, "Verifying")
- **Themes:** the default GeoHUB look is `:root:not([data-skin])`; a skin is
  `data-skin` on `<html>` (`scripts/theme.js`). A look change scoped to no theme
  overrides all six skins. Layout (spacing, heights) may apply to all.
  (themes-and-membership.md; side-panels.js "Frontier skin")
- **The planets share Earth's modules**, except what lives in a stylesheet: a rule
  in `viewer/styles.css` is Earth-only. Cross-viewer styling goes in an injected
  sheet (side-panels.js, section-activity.js). (gui-panels-and-catalogue.md)
- **Data is local first:** datasets under `data/global` are baked locally, verified,
  then published to R2 (`publish-data.py` / `publish-tiles.py`, audited by
  `services/audit-published.py`). Never delete the local copy after publishing.
  (data-and-hosting.md)
- **Never push without being asked.** Commit locally; the user says when.

## Topics

| Note (`GeoID_GIS/docs/notes/`) | Covers |
|---|---|
| `foundations.md` | coordinate frames, draping, draw order, imagery refine, names and where things live, cache-busting, running, testing, verifying |
| `data-and-hosting.md` | global vector data and geology tiles, World Stress Map, Esri imagery, native resolution, the R2 bucket, `hotlink-ok`, canvas-tainting CORS, rclone headers, gitignored assets |
| `globe-rendering.md` | streamed elevation, `camera.fov`, drapes and lifts, raycasts against relief, remembered views, posing cameras, Core View, sea level, floating layers |
| `gui-panels-and-catalogue.md` | the nav taxonomy, attribute table, Workspace, workbenches and rail, tabs and sub-tabs, catalogue rows, cards, the tools window, legends in the GUI, the planets inheriting GUI work |
| `site-shell-and-header.md` | GeoHUB and myGeoID naming, the disclaimer, music player, website header and nav, mode bar in the shell header, journal, Docs windows, the root service worker |
| `symbology-and-legend.md` | symbology window, numeric vs categorical columns, single-symbol keys, opacity on streaming layers, how strongly a layer lands |
| `themes-and-membership.md` | the six arcade skins, what a theme can restyle, membership gates (which are real), the Stripe webhook, live membership |
| `drawing-tools-and-exports.md` | drawing grammar, the extent picker, the tool registry and its sweeps, extraction within any polygon, buffers, QGIS/ArcGIS-ready output, shapefile import and export |
| `geology-and-clipping.md` | the clipping audit, contacts and units, the geotechnical property database, the geology card, world soils, GLiM, click accuracy, the ribbon seal |
| `ice-and-time.md` | ice cover, glacier inventory and volumes, the time-lapse, imagery over time, `time-window.js` / `time-series.js`, bake diffs |
| `events-and-live-feeds.md` | satellites, Earth Engine by subject, live connectors, active fires, submarine cables, volcanoes, the events feed, weather in motion, climate change over time, air and sea traffic, roads and city outlines |
| `hazards.md` | soil and sediment thickness, cyclone risk, volcanic and seismic hazards, WorldPop, forecast landslide risk, the seismic record, hydrography and water bodies, TEMP/PRESSURE readouts, river corridors and flood, watershed and exposure, the risk reader, total risk, study-area reports |
| `neural-flood-surrogates.md` | research note: can neural emulators replace flood/surge/runout simulations, and a sized plan (reference solver, skill scores, residual U-Net) for GeoHUB |
| `model-builder-and-gales.md` | the Model Builder pipeline, layered models, GALES contract and results, mesh quality, tomography, Analysis and Results tools (contours, streams, VTK, calculator…), first solves, any layer onto the mesh |
| `research-hub.md` | the Research Hub and project spine, the sidecar, the hub's look |
| `planets-and-transit.md` | gas giants, planet audits, Explorer Models, a world's recording, planets built like Earth, per-body CRS, flying a moon, Earth's gazetteer, IAU outlines, transit |
| `atlas-agent.md` | the **GeoHUB Atlas agent** (`gis/atlas-*.js`) and its verification ledger. Not the Atlas AI app, which is `~/atlas-ai` with its own graph. |

Adding a note: put it under the topic it belongs to, as a `## ` section, and add a
line here only if it changes a rule for every change.
