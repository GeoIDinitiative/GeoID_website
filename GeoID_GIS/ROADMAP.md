# GeoID — development plan

Where the three pages go from here, and in what order. The end state is an
ecosystem where Atlas AI can learn a project, guide the person working in it,
and watch incoming data on their behalf. Nothing in the last phase works unless
the earlier ones are solid, so the sequence matters more than the list.

Each phase says what it is, why it comes where it does, and what "done" means in
a way that can be checked rather than asserted.

---

## Where it actually stands

Honest baseline, measured rather than remembered:

| | state |
| --- | --- |
| Research pages | 64 of 64 registered. **9 are hand-offs** (`crossPage`) that only open another page; ~12 more are one card deep. |
| Page modules | 4,799 lines across 16 files, plus a 671-line ingest catalogue. |
| Bridge | 8 functions. Everything flows GIS/Model **→** Research. Nothing flows back. |
| Model Studio | 1,987 lines, the deepest single module. |
| Project spine | Real folders, filed by world, Qt-compatible metadata. Solid. |
| Tests | `dsp.test.mjs` (15 checks), `postprocess.test.mjs`. Nothing runs them automatically. |
| FEM loop | Browser writes `spec.json`, `dof_spec.json`, `training_spec.json`. **Nothing reads them.** |
| GEE | SMAP, burned area and GLO-30 snapshots broken; the page never reads `viewer/assets/gee-cache/`. |
| Docs & Sheets | Lists local files only. **The whole Google integration the Qt app has is absent.** |
| Cache-busting | Manual `?v=` on 202 imports. One missed bump serves a stale module. |

The foundations are real. The gap is depth, return paths, and anything that
needs a process that isn't the browser.

---

## Phase 0 — The skin (small, do it first)

**What.** Repaint the Research Hub in the viewer's purple/pink retro skin
instead of the Atlas indigo/cyan.

**Why first.** It is a token rebind in one file, and every later phase is judged
by eye. Judging new pages against a skin that is about to change wastes the
judgement.

Every viewer already loads `/styles/viewer-skin.css`, so the tokens are on the
page wherever the hub is:

```
--skin-chrome  #ff2bd6   magenta — chrome, frames, headings, active states
--skin-data    #00e5ff   cyan    — readouts, measurements, values
--skin-bg      #0d0221   purple-black ground
--skin-panel   22, 9, 51
--skin-ink     #fdf7ff
--skin-muted   214, 194, 255
```

Note the deliberate inversion against Atlas: Atlas makes **cyan** interactive
and **magenta** the project thread; the viewer skin makes **magenta** chrome and
**cyan** data. Follow the viewer, since that is what the user is looking at all
day — magenta for active tabs, rail buttons, card edges and buttons; cyan for
instrument labels, stat values and readouts. The project chip stays magenta and
keeps its pill shape, which is the one piece of Atlas grammar worth preserving.

**Files.** `gis/research/atlas.css` only — the `--atlas-*` block at the top
already funnels every rule, so nothing below it changes. Keep the Qt values in a
comment; the desktop app has not changed colour.

**Done when.** The hub sits beside the GIS sidebar without looking like a
different application, and no rule anywhere else was touched.

---

## Phase 1 — Foundations (nothing else is safe without these)

### 1.1 Kill manual cache-busting

202 imports carry a hand-edited `?v=`. This has already cost real debugging
time: a change that "did nothing" because the browser served the old module.

Add `services/stamp.py` (or a git pre-commit hook) that rewrites every
`?v=<stamp>` under `GeoID_GIS/viewer/` and the `myGeoID` iframe src to the
current commit's short hash. One command, run before every test.

**Done when.** Editing a module and running the stamp is enough; no `?v=` is
ever typed by hand again.

### 1.2 A test runner

Two good test files exist and nothing runs them.

`npm test` → a plain `node --test`-style runner over `**/*.test.mjs`, plus a
smoke test that boots the page headlessly and asserts every one of the 64 pages
mounts without throwing. That last one is the high-value test: the registry
means a page can rot silently for weeks.

**Done when.** `node GeoID_GIS/tests/run.mjs` is green, and it fails if any page
throws on mount.

### 1.3 Finish the project spine

- **Restore the open project on load.** `restoreRoot()` reopens the folder but
  not the project; every reload lands on "No project open".
- **`layers.json` round trip.** `gis/project.js` writes the layer manifest; a
  project should be able to *restore* its layers onto the globe, not just record
  them. This is the first return path and the pattern for the rest.
- **Project templates.** "New volcano-monitoring project" pre-fills the phase,
  study area shape and the ingest domains that matter — this is also where the
  agent will later inject what it has learned.

**Done when.** Open a project, reload, and the globe comes back with the same
layers on it.

---

## Phase 2 — Make three pages one workspace

The bridge is one-directional today. Everything below is a **return path**, and
together they are what turns three pages into one product.

| new bridge call | from | to |
| --- | --- | --- |
| `restoreLayers()` | project `layers.json` | globe |
| `sendToGlobe(path)` | any Research result | a georeferenced overlay |
| `sendToStudio(meshPath)` | `meshes/` | Model Studio, loaded |
| `pickOnGlobe()` | globe click | a probe coordinate in a Research form |
| `watchProject(fn)` | store | live re-render, no remount |
| `openSection(id)` | Research | a *specific* GIS tool, opened and scrolled to |

Two of these change the feel of the product more than any new page would:

- **`sendToGlobe`** — a raster produced by Raster Tools or a classified result
  from the AI Trainer appears on the planet it came from. Right now analysis is
  a dead end: results go to `exports/` and are never seen in context again.
- **`pickOnGlobe`** — FEM probe locations, station coordinates and study bounds
  are all typed by hand today. They should be clicked.

**Also here:** the 9 `crossPage` hand-offs (GIS Explorer, Map, Raster Tools,
Vector Tools, Mesh, XYZ→STL, Point Cloud 3D, FEM 3D Viewer) stop being a button
that says "go over there" and become an embedded, project-aware panel — the tool
runs where you are, against the open project's files.

**Done when.** A full loop runs without leaving the hub: draw an area → extract →
mesh → write a spec → read results back → plot → publish a figure.

---

## Measuring it: the Qt fidelity audit

Rebuilding pages from memory was leaving differences nobody could enumerate.
So the target is now read out of the app mechanically:

```bash
python3 GeoID_GIS/services/qt-extract.py     # app_qt.py -> qt-spec.json
python3 GeoID_GIS/services/qt-extract.py --summary
```

`qt-extract.py` walks `app_qt.py`'s AST and pulls each page class's
`PageHeader`, `addTab`, `CollapsibleSection`, `QGroupBox`, `QPushButton`,
`setPlaceholderText`, `addItems` and header labels — 38 page classes.

`GeoID_GIS/services/qt-audit.js` runs in the browser, walks all 64 pages,
records what they render and diffs it against the spec:

```js
await geoidQtAudit()                    // summary
await geoidQtAudit({ page: "Setup" })   // one page and its gaps
```

**2026-08-08 baseline: 19%** — 642 missing of 788, twelve pages at 0%.
**After spec completion: 98%** — 17 missing of 788, 32 of 38 pages at 100%.

The jump is `spec-page.js`: every page runs its own code first and keeps
everything it does, then whatever the desktop app has and it does not is added
underneath — **disabled, named, and grouped by the tab it belongs to over
there**. Replacing the pages instead would have thrown away working behaviour
(Post Processing really extracts probe series) to score better on a structural
audit.

So 98% is 98% of the *inventory*, not of the function. The controls are all
there and the ones that do nothing say so on themselves.

**Coverage: 63 pages, 1125 elements, 55 exact.** The page-class mapping is
derived from MainWindow's own registry rather than hand-written, which is what
finally brought in the Analysis stage and Pipeline — twenty-five pages a manual
table had missed.

**Controls: 116 of 323 wired (36%)**, almost all from patterns in `wiring.js` —
Refresh, Browse/Import, Open in Globe/Studio, Export CSV, repro snapshot. The
remaining 207 need per-page logic, and a handful need a native binary and are
recorded in `CANNOT_WIRE` as permanently disabled here.

It measures **structure only** — titles, tabs, sections, buttons, field
placeholders, dropdown options, table headers. A page can score 100% and still
do nothing; behaviour is not extractable and has to be written. But a page that
scores low is definitely missing something, and the audit says exactly what.

Run it after every page rebuild. The number should only go up.

## Phase 3 — Depth on the thin pages

**Done so far:** Projects, Docs & Sheets, Data Repository and QA/QC are rebuilt
to their Qt pages, field for field. Every one of the 64 now carries a Qt
`PageHeader` — title and one line on what it is for — rendered by the hub from
`page-blurbs.js`, so a page that has not been rebuilt yet still opens like part
of the app rather than mid-thought.

**The pattern to follow**, in `pages/common.js`: `pageHeader`, `toolbar`,
`collapsible`, `splitPanes`, `tabbedPanel`, `editorCard`, `editorHero`,
`fieldGrid`, `dataTable`, `console_`, `editTable`, `slider`. Read the Qt class
first — the folding and the tab split *are* the design, and a page with the
right fields in the wrong shape is still the wrong page.

The rest, ranked by what a research user actually hits first:

1. ~~Data Repository~~ — done: tree, preview, promote/clone, health, compare.
2. ~~QA/QC~~ — done: File / Spatial / Temporal / Fix & Export, writing
   `metadata/qaqc.json`.
3. **Preprocessing Transforms** — resample, reproject, clip to study area, unit
   convert, join. Currently the weakest link between raw data and analysis.
4. **Statistics / EDA Report** — one-click descriptive report over any table,
   saved as a figure set.
5. **Storyboard / Figure Composer** — the output end. Multi-panel figures,
   captions, export to a single HTML or PDF.
5b. **Docs & Sheets — the Google integration is missing entirely** (see below).
6. **AI Trainer / Feature Engineering** — real train/test split, a couple of
   honest models (linear, k-NN, decision tree in plain JS), saved metrics. Not a
   deep-learning claim; a working baseline that says what it is.
7. **Pipeline Runner / Editor** — execute a saved plan step by step against the
   project, with a log. This is the substrate the agent will drive.

**Done when.** Each page can be used for a real task end to end without dropping
to a terminal.

### 3b. Docs & Sheets — porting the Google workspace

The Qt app's `DocsSheetsPage` (`app_qt.py:24655`) is a real publication
workspace: an embedded browser on a persistent Google profile, a per-project
registry of linked Docs and Sheets held by the Atlas hub, "New Sheet" via
`POST /api/projects/<id>/new_sheet`, and "Attach page to project" via
`POST /api/projects/<id>/links`.

The web page at `pages/workbench.js:390` does none of that — it lists local
`.md`/`.csv` files and stops. This is the single largest feature gap between the
two front ends.

**One constraint decides the design:** `docs.google.com` refuses to be framed,
so the embedded-browser approach is not portable to a web page. Documents open
in a new tab. That is a smaller loss than it sounds — what matters is the
*registry* and the *data round trip*, not the pixels.

Three tiers, each useful on its own and each shippable without the next:

**Tier 1 — the registry, no backend at all.**
`metadata/links.json` in the project folder: `{docs: [...], sheets: [...]}`,
same shape as the hub's. Paste a URL, give it a title, it is filed under the
project and opens in a tab. Lists alongside the local documents already shown.
Because it is a project file, a link filed here is visible to the desktop app
and vice versa — which is most of the interchange value for none of the cost.

**Tier 2 — create and round-trip, Client ID only.**
Google Identity Services' token client gets a Drive/Sheets access token in the
browser from the **public Client ID alone** — the OAuth *client secret* is not
involved and must never appear in this static site. Scope `drive.file` covers
files the app itself creates and needs no verification for ordinary use. That
buys:

- **New Doc / New Sheet**, created and filed against the project in one action.
- **Push a project table to a Sheet** — any CSV in `data/` or
  `post_processing/extracted_dofs/` becomes a live spreadsheet.
- **Pull a Sheet back as a project table**, registered in the data registry like
  any other import, so the analysis pages can read it.

That round trip is the real prize: it makes a Google Sheet a first-class data
source for the pipeline, not just a place to write prose.

**Tier 3 — parity with the desktop, when the hub is reachable.**
If the Atlas hub answers, mirror the Qt calls exactly so links filed in either
front end appear in both, and the hub's Google connection is reused rather than
a second one being made.

**Done when.** A Sheet can be created from the hub, filled from a project table,
edited in Google, pulled back, and analysed — without leaving the project.

---

## Phase 4 — Close the FEM loop

The browser writes three spec files and nothing reads them. Until something
does, the FEM stage is a form.

- `services/fem/runner.py` — watches `geoid_projects/*/*/fem_runs/*/spec.json`,
  validates it, executes the solver, writes results and a `status.json` beside
  the spec.
- The Jobs drawer already reads that folder, so it lights up for free.
- `dof_spec.json` → the DOF extractor; `training_spec.json` → the trainer.
- A `status.json` contract: `queued | running | failed | done`, with a message.

**Why now and not earlier.** It needs a process outside the browser, and it is
the smallest, best-defined instance of that problem — solving it here fixes the
architecture for the agent and the monitor later.

**Done when.** Writing a spec in the browser causes a run to happen and results
to appear in the hub without anyone touching a terminal.

---

## Phase 5 — Real data

- **Fix the GEE snapshots** (SMAP, burned area, GLO-30) and make the page read
  `viewer/assets/gee-cache/` so the common products load with no network.
- **Live ingest connectors** for the domains that have public APIs — USGS
  earthquakes, EONET, GBIF, Copernicus, OpenTopography. The 671-line catalogue
  already describes the domains; give the ones that can be fetched a fetch.
- **A dataset registry per world** — Mars has HiRISE and MOLA; the Moon has LOLA
  and LROC. The catalogue is Earth-shaped today.
- **Provenance.** Every pulled file records its endpoint, query and timestamp.
  The monitor in Phase 7 is only trustworthy if this is.

**Done when.** A new project on any world can be populated with real data in
under a minute, without a manual download.

---

## Phase 6 — Atlas AI: guidance

**The decision that has to be made first.** A browser cannot host a model, and a
static site cannot keep a secret. There are three places the agent can live, and
they are not equivalent:

| where | cost | can it watch data? | secrets safe? |
| --- | --- | --- | --- |
| **Desktop Atlas hub** (exists) | none | only while running | yes |
| **Small cloud service** | ~$5–20/mo | yes, always | yes |
| **In-browser, user's own key** | none to you | no | user's own key, kept local |

Given "I don't want to spend any money from my billing account", the sensible
path is: **build against the desktop hub first** (it already exists, it already
reads the same project folders), keep the interface a plain HTTP contract, and
leave the cloud service as a drop-in later. The in-browser option is worth having
as a fallback for people who have their own key and no desktop app.

**What "guidance" means concretely, in order of usefulness:**

1. **Project-aware answers.** The agent reads `metadata/project.json`, the data
   registry and the QA report, and can answer "what have I got, and what is
   wrong with it".
2. **Next-step suggestion.** Given the project's phase and what is in it, propose
   the next pipeline step — and *write it into the pipeline plan* rather than
   just saying it. It drives the runner from Phase 3.7.
3. **Explain this result.** Point at a spectrum, a residual or a QA flag and get
   an interpretation grounded in the project's own metadata.
4. **Learn the user.** Which stages they use, which they skip, what they rename
   things. Stored in the project, not in a cloud profile.

**Done when.** The Copilot drawer — which currently says plainly that it is not
wired — is wired, and its first useful act is proposing a pipeline step that
actually runs.

---

## Phase 7 — Atlas AI: monitoring and alerts

The endpoint, and the one that genuinely cannot be done in the browser.

- **A watcher** on the service from Phase 6: polls the catalogues from Phase 5
  on a schedule, scoped to each project's study area and world.
- **Triggers as project data.** `metadata/watch.json` — "tell me when a M4+
  earthquake lands within 50 km of this study area", "when new SAR covers this
  polygon", "when this station's series exceeds 3σ". Written by a form *and* by
  the agent, readable by both.
- **Alerts land in the hub.** The Alerts drawer already exists and reads the
  project; give it a real feed. Optionally email or push.
- **From alert to analysis in one click.** An alert carries enough context to
  open the globe framed on the event with the relevant layer loaded — which is
  the whole ecosystem paying off in one gesture.

**Done when.** Something happens on Earth (or Mars), and the project tells you
about it before you thought to look.

---

## Sequencing summary

```
0  Skin                     small, first, unblocks visual judgement
1  Foundations              stamping · test runner · project restore
2  Return paths             the bridge both ways; embedded tools
3  Depth                    repository · QA · transforms · stats · figures · trainer · runner
3b Docs & Sheets            link registry · Drive round trip · hub parity
4  FEM loop closed          first non-browser process; sets the pattern
5  Real data                GEE fixed · live connectors · per-world catalogues · provenance
6  Atlas AI guidance        decide where it runs, then answers → suggestions → learning
7  Atlas AI monitoring      watchers · triggers · alerts · one-click into context
```

Phases 0–2 are worth doing before anything else regardless of where the project
goes; they are the difference between a demo and a tool. Phase 4 is the fork in
the architecture, and it is worth reaching deliberately rather than by accident.
