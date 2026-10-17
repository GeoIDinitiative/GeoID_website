# Foundations: frames, draping, draw order, names, cache-busting, running and verifying

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

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

**And it stamps geometry added LATER too** (`watchLateChildren`, on three's
`childadded`). A layer can grow without the list changing — the earthquake
time-lapse registers an empty group and builds each frame's points the first
time the frame is shown — and a late frame node kept a Group's default 0, so
its points sorted at groupOrder 0 and the Sentinel-2 refine patch (groupOrder
0, renderOrder 40, depth test off) painted straight over the plotted quakes.
Pinned in `layer-stack-late.test.mjs`, which runs the real function against
real three.js objects.
## The imagery refine streams as you pan

Supersedes "nothing is fetched during motion" and "fires only on rest" in the
refine notes below. Reported as having to zoom out and back in to see another
region at the same zoom. Two causes: the settle was DROPPED whenever the
previous pass was still `busy` (a full pass is seconds), and refinement ran on
rest only. Now (`basemap-drape.js` + `view-extent.js` `onViewChange`):

- a light MOTION pass (≤ 64 tiles, ≤ 2048 px canvas) every 400 ms while the
  camera moves, and a full pass on settle — a settle after a motion pass always
  sharpens, even with an unchanged view (`grade`);
- every pass supersedes the last; the old pass's partial patch is kept as ONE
  fallback under the new one (≤ 3 patches, restacked 40.00/40.01/40.02);
- `tile-streamer.js` counts interest per pass (`claimTile` / `releaseOwner`):
  a request is dropped (queued) or aborted (on the wire) only when NO pass
  wants it — still never by one caller — and a new pass claims its tiles
  synchronously BEFORE the old one is released, so shared ground carries on;
- one GLOBAL budget of 12 (`MAX_INFLIGHT`), newest pass first, coarsest ring
  first, centre-out from where the camera LOOKS (`viewFocus`), not the box's
  middle; fetch + `createImageBitmap` (cancellable, decoded off the main
  thread), `<img>` where those are missing; a true LRU of 640 decoded tiles.

Verified headless with EOX routed to generated tiles (the sandbox blocks the
host): 75–120 stale requests aborted over a 48° pan, motion passes centred on
the camera throughout, and on settle one complete patch under the view with the
fallback gone. Playwright's `page.route` does not see requests the site's
service worker makes — block service workers in the context.
## Switching the basemap off

Drops `colorWrite`, not `visible`. A mesh that is not drawn writes no depth and
the planet stops occluding — the moon's orbit line and far-side event markers
then show through it.
## The names: GeoHUB, and myGeoID inside it

**GeoHUB is the workspace; myGeoID is a product made in it.** The page at
`/` is the whole thing — the GIS globe, the planetary explorers, the
Mesh Studio and the Research Hub. **myGeoID** is the risk mapping built on that
GIS page: the Factor-of-Safety pipeline in `geoid-mode.js` and
`geoid-pipeline.js`, which is why the sidebar section that arms it is named
myGeoID and the page is not.

What that means when editing copy: a mention of myGeoID that describes a
personal hazard dashboard, a Factor of Safety, or the funding case is **the
product** and keeps its name — `about_myGeoID/` is entirely about that and did
not move. A mention that names the app, the page or the shell is **GeoHUB**. The
tell is usually the link: text on an `href="/"` names the workspace.

**The old path still answers.** `/myGeoID/` is a stub that redirects to
`/`, carries `rel=canonical` to it and `noindex` on itself, because that
path is in bookmarks, in shared links and in search results. Internal links all
point at `/`. The service-worker cache version had to move with it
(`geoid-site-v40`) or a returning visitor keeps a precached nav that still says
myGeoID and still links to the old path.

Internal identifiers were deliberately NOT renamed: `geoid-gis:view-mode`, the
`geoid` mode id, `#gis-group-geoid`, `geoid-mode.js`. They are storage keys and
element ids with no user-visible surface, and churning them risks behaviour for
no gain. The CSS wordmark classes gained `.geohub-word`/`.geohub-prefix`
alongside the `.mygeoid-*` pair rather than replacing it, since the product may
still want the same two-tone treatment.
## Where things actually live

- Runtime manifest: **`earth-manifest.js`** (inline object). `manifest.json` on
  disk is stale and unused.
- Basemap assets resolve to `/GeoID_Earth/assets/…`, shared with the Earth
  Explorer and Moon viewers — do not delete them when swapping a layer out.
- The Analysis Hub is in the **shell** (`geohub/index.html`), not the viewer.
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

**A backtick inside a CSS template literal ends the string.** A comment in
zoom-bar.js's `STYLE` referred to `` `fitLabel()` `` in backticks; the module
became unparseable from that point, `installZoomBar` never ran, and the control
vanished from the page entirely while the script tag still loaded and the seam
still reported ready — it looks like a placement bug, not a syntax error. The
unit suite imports every one of these modules and says so in one line; that
change was committed without re-running it. **Run `tests/run.mjs` before the
commit, not after the browser disagrees.**

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
it drives `http://localhost:8125/`, runs a setup script inside the
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
## The other viewers are copies, and drift

`planet_explorer`'s five bodies and `GeoID_Earth` carry their own copy of the
popup markup, CSS and render loop; `flight_sim` has seventeen more and
`page_backups` snapshots. Drive them from the canonical file rather than by
hand, and make each edit ALL-OR-NOTHING per file: their card is
`pointer-events: auto` where the GIS one is `none`, so a greedy match updated
markup and JS everywhere and left every stylesheet untouched — which is the
right failure, and only visible because the script reported per file.
## A test that appends against a missing anchor passes silently

`s.replace(old, new)` returns the string unchanged when `old` is absent, so a
patch script prints its success line either way. The shapefile test file uses a
`check`/`failures` harness, not the `ok`/`pass` one, and eleven new tests went
nowhere while the run still said "68 passed" — the same count as before, which
is the only thing that gave it away. Assert the anchor, or diff the count.
