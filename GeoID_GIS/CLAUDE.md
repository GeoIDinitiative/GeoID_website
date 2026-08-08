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

**Do not rebuild a page from memory.** `services/qt-extract.py` parses
`app_qt.py`'s AST into `qt-spec.json` — every page's title, subtitle, tabs,
collapsible sections, group boxes, button labels, field placeholders, dropdown
options and table headers. Read that page's entry before writing it, and run
`geoidQtAudit()` (`services/qt-audit.js`, in the browser) after. The baseline
when the audit was built was **19% — 642 missing elements of 788**; it is the
only honest measure of "identical to the Qt app" there is, and it measures
structure only, never behaviour.

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
