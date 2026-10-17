# Planets, moons, flight, gazetteer and transit

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## The gas giants: what is absent by design, and the one thing that lied

Audited on Jupiter and Neptune. **What works there, measured:** every radius
is the correct IAU mean (Jupiter 69,911 — the Saturn mix-up stays fixed;
Saturn 58,232, Uranus 25,362, Neptune 24,622); the import pipeline is whole;
buffer, clip and IDW all run on imported data; and an imported polygon's area
is computed on that body's own radius (Neptune: 2,909,274 km² against a
predicted 2,909,865, ratio 1.000). `terrain` refuses honestly — "this world
exposes no elevation to sample" — and the draw HUD is correctly absent,
because a gas giant has no `setStudyAreaPolygon` and no surface to draw on.

**But the Draw button itself was still live, and lying.** Gating the HUD was
only half the job: on Jupiter the button was enabled, labelled "Activate draw
tool", and took the active state on click. Measured — armed, then three
clicks on the globe produced ZERO measure points, no line and an empty
readout. That is this tree's own rule pointed at itself: *wire it or leave it
disabled.*

**Only AREA is dead, and that distinction is the whole fix.** Distance and
Profile go through the ordinary measure path and work perfectly on Jupiter —
measured, two points each — so disabling the row wholesale would have taken
away two tools that do their job. `draw-hud.js` (shared, so one edit reaches
all four) disables the Area button and titles it with what still works.

**Ten seconds, not sixty.** The retry runs to 120 tries because a seam can
genuinely be late, but a button must not sit there enabled and lying for a
minute: measured on Mars, both the seam and the HUD are up before a probe
fired immediately after load could even look. Stood down at 20 tries, watched
to 120, and a seam that does turn up late takes the button back.

**The draw bar on the rocky worlds is Earth's, byte for byte.** Reported as
not matching, and it does: Mars and Earth both render eleven buttons in the
same order with the same shapes, titles and widths (31/31/31/31/31/31/31/67/
52/30/31) in a 471x65 bar — Line, Circle, Triangle, Square, Rectangle,
Pentagon, Hexagon, Custom, Done, Export CSV and close. It is one shared
module and there is nothing per-body left in it. Where the bar is missing,
the body is a gas giant and the reason is the surface, not the code.
## The same audit on the planets: two faults, both per-body

Running the Earth audit on Mars first. **What already worked, measured rather
than assumed:** the seam is complete (34 keys, none of
`surfacePoint`/`getEffectiveRelief`/`elevationNormalized`/`sampleElevationMeters`/
`getGeologyFeatureAtLatLon`/`setStudyAreaPolygon`/`pickOnGlobe` missing);
geology answers real unit codes (Ave, eHv, HNhu, Nhu); `terrain` reads
Olympus Mons at 19,837 m and reports **Mars's own** source sampling as
5,325 m; slope, zonal statistics and the drawn-shape band all behave as on
Earth, because they are shared modules.

**Every area on a planet was measured on EARTH's radius.** A 4x3 degree study
box near Olympus Mons recorded 140,689 km² against a true 39,826 — exactly
the 3.533 that (R⊕/R♂)² predicts; on the Moon it would be 13.4x, on Mercury
6.8x. `sphericalPolygonAreaKm2` defaults to the Earth mean radius and FOUR
callers took the default: drawn-layers' `area_km2`, the geology card's mapped
area, and both of feature-popup's. The number rides on the layer, so it
reached the annotation, the exports and the project registry alike.

Fixing callers one at a time is what left three wrong after the first was
found, so **the DEFAULT is what changed**: it reads `bodyRadiusKm` off the
viewer seam and falls back to Earth only where there is no viewer to ask,
which is Node and the tests. `area-labels.js` had already taken its
km-per-degree from `bodyRadiusKm` for the live label — that was the SECOND
area computation and only it had been made per-body. Same shape as the
polygon-area formula in ten files: **when a body constant is fixed in one
place, grep for the others.** Verified on Mercury: 21,318 km² against a true
21,321 on a 2,439.7 km radius, ratio 1.000.

**And the measure furniture Earth changed never reached the planets**, because
it lives OUTSIDE `port-draw-tools`' block: the study-area corner card still
popped up and polygon points still wore A, B, C. Measured on Mars —
`#measurement-result-card` visible reading "Study Area: 39821 km² / Perimeter
803.6 km / …" where the same shape on Earth leaves it hidden and unpopulated.

The porter carries four rewrites now, applied verbatim per viewer and
idempotent (a rewrite already present is skipped, so a re-run is a no-op and
`--check` tells stale from ported):

1. no corner card for an AREA — `hideMeasurementResultCard()`, not show;
2. point letters are PROFILE furniture only;
3. **a letterless point still scales its DOT** — the planets' guard was
   `!visual.marker || !visual.labelSprite`, which bails on the WHOLE visual,
   so without this every marker rewrite 2 creates would freeze at its build
   size. That is precisely the trap Earth's own note records;
4. the sprite work is guarded on its own, after the marker work.

Each viewer keeps its own scaler body — the planets carry clamping and
flight-sim attenuation Earth does not have — because the point is to port the
DECISION, not to overwrite the arithmetic around it. Verified on Mars and
Mercury: card hidden, 41 marker dots and **0 letter sprites** in the measure
group, and the dots still resize with the camera (2.728 → 2.586).

**A change made on Earth is only shared if it is inside the ported block.**
When an Earth fix touches `earth-viewer.js`, check whether it falls between
the porter's anchors; if it does not, it needs a REWRITES entry or nine
worlds keep the old behaviour indefinitely.
## Explorer Models: a Tour Mode for the other viewers, and the audit's own assumptions

### Everything published IS in R2 — the audit was reporting its assumptions

"Are all datasets being saved and fetched to R2?" `audit-published.py` said no:
**ice, 2 objects differ from the local copy**. Measured, all three differences
are expected and the data is intact:

| | why it differs |
| --- | --- |
| `manifest.json` | `publish-tiles` stamps `tiles_base` into the LOCAL copy AFTER uploading, and the site reads that one |
| `names.json`, `thickness.json` | `publish-data` stores them **gzipped at rest** — 5.5 MB on disk against **1.34 MB** in the bucket |

Both sidecars are **byte-identical once decompressed** (md5 equal), served with
a strong ETag and `content-length`, which is what says STORED gzip rather than
Cloudflare's on-the-fly slow path. `drifted()` now takes the set `sources.json`
publishes and skips those inside a pyramid's folder, alongside the manifest it
already skipped; everything else must still match byte for byte. The audit's
own header records this trap and it walked into it: *a check that does not know
what correct looks like reports the difference between its author's assumptions
and reality.*

**And a probe must ask the way a browser asks.** My first check read no
`content-encoding` on either sidecar and I read that as "not gzipped" — the
request had not sent `Accept-Encoding: gzip`, so the edge decompressed the
stored object on the way out. `publish-data.py --check` had it right all along.

Clean afterwards: **7 pyramids (17,483 tiles), 45 loose files, 11 viewer-asset
prefixes, 0 dangling local references, 13 metadata files tracked**, all present,
byte-identical, reachable and CORS-open.

### The subtab

**The first version was a list of links with hero tiles, and it was wrong.**
"It should copy the tour mode tab (Enter) and then jump to the Etna and
Everest locations — link within the pop-up description, automatically spawns
with jump." So it is Tour Mode with a different stop list: the places on this
globe that have a viewer of their own.

- **Etna already had the link, hard-coded.** `openFeature` carried
  `if (feature.name === "Mount Etna")` — which is how Everest came to have a
  whole first-person viewer on this site and no way to reach it from the
  globe. `EXPLORER_SITES` is the one list, published on the seam: the CARD
  reads it to decide whether to draw a link, and the TOUR reads it to decide
  where to stop, so a stop can never be a jump to nothing.
- **The link spawns with the jump because `presentTourFeature` opens the card
  FIRST and flies 700 ms later.** That ordering is the whole mechanism, and it
  is the viewer's own — the module asks for it through `tourToFeature` and
  touches no camera. Pinned in both modes; reversing it fails.
- **The Enter button is `scripts/tour-enter.js`'s**, the one implementation
  every armed section uses, so the Exit label, the armed retint and the
  open-the-panel-on-entering all come for free. The module drives only the
  hidden checkbox behind it.
- **BORROWING `presentTourFeature` WHOLE BORROWED ITS ARMING.** Seen in one
  screenshot of the working feature: the globe over the Himalaya with
  Everest's card and its ASCENT link, and TOUR MODE reading Exit in the
  sidebar with its own picker claiming the stop. `scheduleFeatureFlight` is
  now the mechanism and `syncTourModeControls` the arming; the seam jumps
  without arming anything, entering stands Tour Mode down through its own
  checkbox, and the jump asks for the tour's slower arc explicitly (`tourHop`)
  rather than inheriting it from whether Tour Mode happened to be armed.
- **`tests/ui.py` caught the stop list being filled on ENTER**, which leaves
  the picker sitting empty in the panel — "a control left empty for its
  handler". It is a bounded retry now (48 × 250 ms), because this module loads
  before the viewer does.
- **The link carries `target="_top"`.** This viewer runs inside the GeoHUB's
  iframe, and a bare link would load a second viewer inside it.

**A scanner that reads comments finds the fault it is checking for.** Two pins
failed on my own prose — the module explains the ordering by saying "flies the
camera 700 ms later", and the viewer's comment quotes the
`feature.name === "Mount Etna"` block it replaced. Strip comments first, as
tool-runner's param scanner already does.

Measured live: Enter → Explorer Models armed and Tour Mode not, camera at
37.751/14.993 with Etna's card and "Open Etna Viewer →"; Next → 72.6° to
27.988/86.925 with Everest's card and "Open ASCENT — Everest →".
## A world's recording belongs to its globe

"Sounds of Mars lingers as we jump from page to page." Measured: it played
straight through GIS → Model → Research → GIS, because **those three are ONE
DOCUMENT** and a mode change is not a navigation. Viewer to viewer it really
does stop — the element dies with the document (measured, paused and reset
within 1.2 s) — so the two halves of the report were different faults.

The Meshing Studio and the Research hub take the whole screen; the planet is
not on it, and a control captioned with that planet's credit is a control for
something the reader has left. So `modeBarState` offers the recording only in
GIS mode and `stopWorldAudio` stops it on the way out, **by clicking the page's
own button** — pausing the element behind its back leaves the viewer's own
control showing a pause icon over silence. The app's PLAYLIST is untouched,
which is the difference between the two sources this bar has always kept apart.

**THE DOCUMENT THAT IS LEAVING SAYS SO, because nothing else can.** The worlds
strip is ordinary links INSIDE the viewer, so the shell never sets the frame's
src and would only learn of a navigation when the NEXT world had finished
booting — for the whole of which the header went on offering the previous
world's recording by name. `pagehide` posts `geoid:modebar-gone`; the frame's
own `load` catches a document that went without saying anything. The MODE PILLS
stay up: they are the shell's own way between the three modes and are identical
on every world, so blanking them for a boot would be a flicker in the one part
of the bar that never changes.

Measured: Model and Research stop the sound and hide the button, back to GIS
restores the control without restarting the sound; Mars → Jupiter drops the
button at **+400 ms** and returns it at **+1.6 s** with Jupiter's own credit;
the Moon, which has no recording, keeps it down.

**A VERIFICATION THAT SHOWS NO CHANGE IS THE SERVICE WORKER FIRST.** The first
run of this fix appeared to do nothing, and the served module plainly contained
it — `fetch` returned the new text while the loader ran the old. The `?v=` is
the git sha, so an uncommitted edit re-stamps to the SAME value and the SW's
precache answers. Unregister it and clear caches before believing a null
result; or commit first, which changes the stamp.
## The planets are built like Earth, and GeoHUB can reach and wake them

**The rule: a planet's deck is Earth's markup, not a lookalike.** Every planet
`viewer/index.html` carries Earth's row verbatim —
`.brand-toprow > .brand-toprow-actions > #music-btn` (glyph `▶`, `aria-label`).
`shell.js` fills the project button and the mode switch into that row and
already inserts the switch *before* an existing actions container, so the row
reads project · modes · music exactly as Earth's does. The planets used to ship
an EMPTY `.brand-toprow` and a loose body-level `#music-btn` reading
"▶ MUSIC" — the floating pill that made every planet look a version behind
whenever the page drew its own deck. Three forks had to move together:
the markup, `shell.css` (Earth's in-row rule, BOTH selectors — the bare one is
out-ranked by `body.is-embedded #music-btn`), and the nine `music.js` copies
(glyph-only labels). Verify with computed style, not by eye: Earth and the Moon
match on all sixteen properties and both put the button at 348,35.

**Transit is a wire.** Inside GeoHUB the frames nest shell → `/transit/` →
viewer, and the shell posts to its DIRECT child. `transit/index.html` relays
anything `geoid:`-prefixed down from the shell and up from the viewer, and
answers nothing itself. Without it the viewer never gets `modebar-hosted` and
draws a second deck under the header. Standalone transit relays nothing.

**Never gate a render loop with `{ once: true }` on `message`.** It fires on the
first message of ANY kind and removes itself; the shell's host message always
beats transit's `geoid-reveal`, so the gas giants rendered 0 frames through
GeoHUB. Wait for your own message and remove the listener when it arrives.

**`_headers` does not beat the zone.** Cloudflare's Browser Cache TTL raises
anything shorter to `max-age=14400` for JS and CSS (HTML gets 600), so a
deploy is only visible if the URL changes. Every same-origin `<script src>`
and stylesheet on a page `stamp.py` sweeps now carries `?v=` and moves on
every commit. **Consequence: never look a script up by its exact URL.**
`querySelector('script[src="moon-manifest.js"]')` stopped matching the moment
the tag was stamped and would have failed Mercury, Venus, the Moon and Pluto
at boot; those lookups are prefix matches (`src^=`) now.
## The planets draw, measure and fly like Earth — and what that took

**Supersedes** the notes above that say a gas giant "gets no HUD", "is left
alone", or that "drawing is the only per-body gate". All ten worlds now draw.

**A drawn area was invisible on half the planets.** The captured outline went
through the SEAL at 1.5 px in the default dark navy, which on Mercury's grey or
Pluto's brown is not there. `drawn-layers.js` declares its colour (cyan
`#5fe1ff`) and passes `strokeScale: 3`; `followRelief`'s `ribbonScale` widens
ONLY an outline-only layer, so a filled map's seam cover stays a hairline.

**Imported layers on Pluto sat on the far side** (facing −0.995). `syncSpin`
assumed the globe is `π + spin`; Pluto's globe carries no half-turn. The seam
answers the frame directly now — `getSpinDeltaRadians: () =>
measureGroup.rotation.y` on all nine planets (`port-viewer-seam.py`), and
`import-manager` prefers it to `globeY − π`.

**The gas giants draw.** `port-draw-tools.py` writes the Earth block into them
too, behind a GAS prelude (`// >>> GEOID-GAS-STUDY-AREA`) that supplies what
the block reads and a giant's viewer lacks: `activateStudyArea`, a vertex
builder that rebuilds a moon point in the MOON MESH's frame, the seam's
`setStudyAreaPolygon`/`clearStudyArea`/`getExtractionGeometry`. The rocky
REWRITES are never applied to a giant (they name `surfaceAnchor` and other
locals a giant does not have) — `draw-port.test.mjs` pins that, and pins that
all four carry the block. `port-gas-measure.py` first lifts Saturn's
measurement functions (the moon tidal-locking fix) into Jupiter and Neptune,
which forked before it; they are lifted by BRACE-MATCHED spans — an indent rule
cut Neptune's `updateMeasureVisualization` short, which `node --check` on a
`.js` passes and the same file as `.mjs` refuses.

### Flight

- **The Workspace, draw bar, zoom pill and workbenches hide in flight**
  (`styles/flightsim.css`, on `body.fs-flying`/`.fs-preflight`), and an armed
  draw tool stands down on `flightsim:engaged` (draw-hud.js).
- **Below 900 km a world with one global texture gets a DETAIL PATCH**: one
  image under the ship from USGS Astrogeology's planetary WMS (CORS-open,
  simple cylindrical), re-fetched as the ship moves (flightsim.js
  `updateDetailPatch`). Venus's texture is 9.3 km a pixel, so below ~50 km the
  view was a handful of texels and nothing moved — reported as "we never
  descend". **The first cut drew a fully transparent image**: the edge feather
  used `destination-in`, an UNBOUNDED composite that clears everything outside
  the rect being drawn, so four edge strips left zero opaque pixels and the
  coarse globe showed straight through. `destination-out` is bounded.
  Measure a canvas texture's opaque count before blaming the scene.
- **The sim speaks the VIEWER's longitude.** `worldToLatLon` read the scene
  angle, which equals the viewer's longitude on every world but Mercury
  (west-positive, scene = 180 − W). On Mercury the HUD, the ground under the
  ship, the launch site and the patch were all mirrored — the patch landed
  4,300 km away. Mercury's hooks give `sceneLonToViewerLon` and
  `lonWestPositive`; the HUD reads °W there and the gazetteer is fed east.
- **The giants fly.** Each carries a `__flightSimHooks` block (no elevation, no
  relief: the floor is the 1-bar deck at the drawn radius) and **its render
  loop calls `__flightSim.update(camera)`** — the call the rocky viewers
  always had; without it the sim engages and never moves. Launch altitudes,
  the ceiling and the warp roof scale with the planet
  (`GAS_LAUNCH_FACTORS`, default 0.7 R: Jupiter 49,000 km, Neptune 17,000);
  the atmosphere is `giantAtmosphere` (1-bar temperature, dry adiabat to the
  tropopause, scale-height pressure); the gazetteer names latitude bands only,
  because a storm drifts against any fixed longitude system.

### Transit, reveal and a 0 x 0 canvas

The giants hold their render loop until transit sends `geoid-reveal`, which it
posts ONCE — a viewer still loading then missed it and stayed black for good.
The viewers already read `window.parent._geoidReveal` first; transit never set
it. It does now. And a viewer that initialised while its frame was
`display:none` sized its renderer from a zero viewport and was never told
otherwise (Neptune drew into 0 x 0 inside 1600 x 785): transit dispatches a
resize into the frame at the reveal AND again on the viewer's `geoid-ready`,
because a viewer still initialising at the reveal has no listener yet.

The transit logo is the GeoID wordmark on every destination (it was each
world's Planet Explorer badge), sized by width with the height following.

### The Moon viewer does not grey itself

The moon-mode dim rule excluded `#moon-viewer-section` — which sits INSIDE the
Explorer tab, itself a `.control-section`, and a parent's opacity cannot be
undone by its child. The rule now also excludes any section that
`:has(#moon-viewer-section)` or `:has(#locations-section)`, in all seven
planet stylesheets that carry it.
## Every body is its own CRS: a moon's shape stays on the moon

Reported as a polygon drawn on Jupiter appearing on Io: "STUDY AREA 1,
1,102,920,913 km², 42,251 × 38,928 km" over a moon 3,600 km across. Four
faults, one principle — a coordinate means nothing off the body it was taken
on, and nothing may carry it across:

- **The saved shape's LABEL was projected with the ACTIVE measuring body.**
  `window.GeoIDProjectLatLon` (what `area-labels.js` writes saved shapes'
  annotations through) used `getActiveMeasureContext()`, which is the moon
  while a moon viewer is open. Workspace layers are the planet's; the seam
  projects with `planetMeasureContext()` now.
- **`measureFrameGroup` read "a moon viewer is open" as "this is a moon
  shape"** (`|| activeMoonViewerFeature`). The shape's own context decides.
- **Kilometres were always the planet's** (the porter turns 111.32 into the
  planet's `DRAW_KM_PER_DEG`). `studyKmPerDeg(context)` reads the shape's own
  radius; a box on Io reads 799 × 918 km, not Jupiter-sized.
- **A moon point's handles skipped the moon mesh's rotation**, so they stood
  a quarter of the moon from their box. `moonMeshWorldPoint` (gas prelude)
  places them through the mesh — which has to be found from the POINTS,
  because a stored context is a clone without its mesh.

And the rules around them: a live, unsaved shape is PUT AWAY when the viewer
turns to another body (`putAwayShapeFromAnotherBody`), with the tool left
armed so the next drag draws on the body in view; a drag ignores hits on any
body but the one it started on; the seam places GIS extents on the planet
whichever moon is open; a moon shape is not an extraction geometry, and
saving it says why (`studyAreaOtherBody`). Uranus's planet context was named
"Saturn" — a clone's leftover — and is "Uranus".
## Flying a moon: the planet's flight code, answering for another body

Open a moon viewer, press Enter on the Flight Simulator and the sim flies
THAT moon — no new tab. One implementation, in `scripts/flightsim.js`; each
moon-carrying viewer (Mars, Pluto, the four giants) adds one hook,
`getFlightMoon()`, built on its own `getMoonMeasureContext()`.

- **`hooks` is a Proxy over the viewer's hooks** (`bodyHooks`). While a moon
  is in view (pre-flight) or bound (flight) it answers from `moonHooks`: the
  moon mesh as the body frame, lat/lon in the mesh's own frame (the inverse
  of `vectorToLatLon`, the frame its texture and features use), the moon's
  radius, no spin, no elevation — and `terrainScale`, `baseLayerSelect`,
  `ctxDetailStreamer` null, so flying Io never switches or stretches
  Jupiter's basemap or relief. Every line of the sim then reads the moon
  without being told.
- **The flight is BOUND to one body at engage** (`flightMoon`). Opening,
  closing or switching a moon viewer mid-flight ends it — the separation
  rule the drawing tools follow — rather than carrying coordinates across.
- **The moon frame.** The sim's radial arithmetic assumes its body at the
  WORLD ORIGIN with a 3.2 datum; Io is ~0.1 units and orbits Jupiter. For
  the flight the world's content goes into one group scaled and moved to put
  the moon there (a similarity, so every angle and relative size — the view —
  is unchanged), re-centred each frame. LIGHTS stay out (a directional light
  aims at the origin, now the moon, so its direction is kept) and so do the
  sim's ship and explosion (`simOwned`), which are placed in world units.
  Scaling the SCENE itself would have rescaled those too. `camera.far` scales
  with it; on exit everything goes back and the camera is left beside the
  moon, looking at it, in the moon viewer.
- **What differs per moon**: gravity from NASA's figures (else from radius
  at an icy-rock density), Titan's thick air, Triton's and Io's whispers,
  vacuum otherwise; launch altitudes in the moon's radii; hemisphere names
  rather than Mars's gazetteer; the HUD longitude through the viewer's own
  `moonSceneLonToW` where it has one (°W as the cursor readout shows).
- **Speed has a size cap**: the ceiling was sized to how much ground is in
  view, which says nothing about the body — a lap of Phobos a minute. A lap
  now takes at least five minutes; binds only below ~570 km radius.
- **The scale bar stands down** (`body.fs-moon-flight`): it measures in the
  planet's units and read "500 km" over Phobos.

Measured: Io from 360 km (°W, "Io atmosphere"), Phobos (0.11–23 km list,
236 m/s), Charon, Mimas, Triton (7.9e-9 Pa aloft); each disengage restores
the scene with no frame group left; Jupiter and Venus fly as before.

### What a moon flight needed after the first cut

- **Detail imagery.** `MOON_DETAIL` names each moon's USGS WMS mosaic
  (Viking for Phobos and Deimos, Galileo/Voyager for the Galilean moons,
  Cassini for Saturn's, Voyager 2 for Triton, New Horizons for Charon; the
  Uranian moons have none). The WMS is EAST longitude (measured at Io's Loki
  Patera, 51°E), and the patch is placed through the moon's own °W rule
  (`eastOf = 360 − W`). With no such rule a moon gets NO patch rather than a
  misplaced one. The patch's reach is body-sized (`halfKm`), or over Phobos
  it covered the moon several times over.
- **A moon mosaic has HOLES, and a JPEG fills them with opaque white.**
  Voyager 2 imaged Triton's southern half: the first patch drew the
  unimaged north as a pale slab across the ground. A moon's patch is a
  transparent PNG — 8-bit for a grey mosaic (a third of the bytes), full
  colour for Io's `SSI_VGR_color` — and a planet's whole mosaics stay JPEG.
  Measured: the server takes ~1.2 s for either; the PNG is 0.5–1.9 MB
  against 50–220 KB.
- **The texture correlation was right to be doubted and wrong to be
  trusted.** Triton (r 0.986) and Charon (0.975) correlate at identity with
  their WMS mosaics; Phobos read r ≈ 0.18, and that was the LIGHTING, not an
  offset — Stickney sits on the −49°E line in both images, and so do the big
  craters beside it. Check a weak correlation by eye before calling it a
  misregistration.
- **A moon's °W is FITTED from its own feature markers** (`flightMoonLonRule`
  in each of the six viewers): W = ±meshLon + b over the markers, via the
  viewer's `moonLonToW` where it has one, accepted only under 1° of worst
  error. The first-guess rules were up to 180° off on Mars, Pluto and
  Neptune. Verified 0° on Io, Mimas, Miranda, Phobos and Charon.
- **The gas giants' moon marker caps read the frame's scale**
  (`marsGroup.getWorldScale(…).x`). The moon frame SCALES the world round
  the moon by k = 3.2 / its radius; a pixel cap computed in unscaled units
  drew every feature marker as a huge red disc.
- **Pre-flight never loosens a zoom cap the viewer holds.** It set
  `maxDistance` to 4.5 planet radii, which over a moon viewer's 0.58 unit cap
  let the camera back out over Mars while aiming at Phobos; it takes the
  minimum now.

**A 0 × 0 canvas in the harness looks like a broken moon flight.** The
transit frame can boot before it is sized; `camera.aspect` is then NaN, the
aim ray is NaN, pre-flight reads "Aim at the surface" and the launch is
disabled. Dispatch a `resize` into the viewer before entering flight.
Also: the viewer's own `__flightSimHooks.pickSurfaceLatLon` is the PLANET's
pick — the sim reads its moon pick through the `hooks` Proxy, so calling
the base hook over a moon reads null and proves nothing.

Verified: Phobos at 90 m with the Viking grooves under the ship; Charon at
75 km on New Horizons' mosaic with Pluto in the sky; Triton over its unlit,
unimaged north with no slab; Io's markers as small dots under readable
labels; a Mars planet flight unchanged (pre-flight cap 14.4, 80 restored).
## Earth's gazetteer: ~2,900 named places, ranked, lazy, OFF at launch

**Superseded default (2026-09-19): the place names and the curated Volcanic /
Mission / Storm / Moon-surface rows open OFF on Earth** (the planets keep their
labels on). What is stored is now the rows switched ON
(`geoid-gis:earth-places-on`); the old off-list key is no longer read. The
Moons row is the Moon itself, not a label, and stays on. The labels are one
row in the Workspace, "Location labels", pinned at the top with an eye only —
it records which rows were on when it switches them off and restores exactly
those. The notes below describe the ranking and engine and still hold; read
"ON when the page opens" in them as the old default.

Explorer ▸ Locations now carries eight category rows — Oceans & seas,
Landforms, Islands, Mountains, Rivers, Lakes, Faults & plates, Cities — over
the curated Volcanic / Mission / Storm rows, and every one is ON when the page
opens. `services/bake-earth-places.py` writes `data/global/earth-places.json`
(2,929 places, 293 KB gzipped, published to the bucket, gitignored);
`gis/earth-places.js` turns it into label items and hands them to the viewer's
OWN engine through `addSurfaceLabels`, so every name wears the same chip,
declutters with the curated ones and opens the same card.

- **The rank is Natural Earth's `min_label`** — the zoom at which its
  cartographers first label a feature, one judgement on one scale for seas,
  rivers, deserts and cities alike. Mapped to lod 1–5 (≤2, ≤3.7, ≤5, ≤6.5,
  else). Two corrections where it is wrong: a river under 250 km cannot be
  above tier 4 (NE labels some delta branches at zoom 3), and a peak's height
  lifts it (8,000 m → tier ≤2, 6,000 m → ≤3). Faults rank by grouped GEM
  trace length, plates by area. Tiers: 69 / 175 / 585 / 1,694 / 406.
- **Anchors sit ON the feature**: a line's point half way along its longest
  part (by LENGTH, not by vertex index), a polygon's representative point
  (inside, never a crescent's centroid in the sea), a plate's mean of unit
  vectors (plates cross the antimeridian).
- **Descriptions** are the opening two sentences of the English Wikipedia
  article found through each feature's own Wikidata id (2,394 of 2,929), else
  the Wikidata gloss if it is a real sentence (a one-word "mountain" is not),
  else a line from the type. Every row names its source and licence
  (Wikipedia CC BY-SA 4.0, GEM CC BY-SA 4.0, NE public domain) and the card
  shows it. Every Wikipedia answer is cached in `.places-work/wiki-cache.json`,
  so `--offline` rebakes without the network.
- **One label per feature**: deduped by Wikidata id across categories (a river
  and its estuary polygon, an ocean cut at the antimeridian) and against the
  curated places (name stem within 3°, or the same name at tier 1–2 anywhere —
  the curated Atlantic is on the equator, Natural Earth's at 34°N).

### The engine changes, and why each one was needed

- **Chips are LAZY.** Built up front, ~3,000 chips at 2x backing is over a
  gigabyte of texture. A lazy entry keeps a shared 1×1 placeholder and a size
  measured without drawing (`labelChipSize`, the same arithmetic
  `makeLabelTexture` uses); `settleLazyLabels` draws a chip the frame it is
  first placed (36 a frame, a chip that misses the budget waits a frame
  rather than showing empty) and releases the longest-hidden past 420.
  `rebuildLabelTextures` (theme change) drops lazy chips back to the
  placeholder instead of drawing all of them.
- **Density is Mars's rule plus the zoom.** A ranked item shows when
  `lod <= slider level + zoomLodBonus` (+1 below a 500 km scale bar, +2 below
  100 km): flying in REVEALS peaks and local rivers instead of only the slider
  doing it. The old priority filter now skips ranked items. Measured at the
  global view: level 1 shows 24 names, 3 shows 64, 5 shows 81 (the declutter
  decides the rest); over the Alps at 450 km the Matterhorn, Monte Rosa,
  Finsteraarhorn, Bern and the Po appear with the slider still at 3.
- **Size is the tier**, as on Mars: `label_scale` 1.42 / 1.2 / 1.05 / 0.93 /
  0.82 at range (measured 21.7 → 18.2 → 16.8 → 15.9 → 10.9 px), and
  `PLACE_MOSAIC_TIER` in the close layout, which targets an absolute pixel
  height and would otherwise cancel it. Gentler than Mars's close ramp:
  Earth's close chip is 20–30 px against Mars's 36, and Mars's floor left a
  tier-5 name at 13 px.
- **A gazetteer name is never forced** onto the screen (force is for the
  curated few), its hit sphere is a dataset's, and its dot is drawn only
  with its name — a thousand anonymous dots is noise.
- **The card's detail rows are text, not markup** now (they carry Wikipedia
  and Natural Earth strings), and gained Population, Significance and Source.
- **Categories and the rank→size rule live in the viewer** (`PLACE_CATEGORIES`,
  `rankPlace`, exposed as `placeCategories` / `rankPlace` / `curatedPlaces` /
  `setPlaceCategoryFilter`), because the curated places use them too: the
  curated oceans, ranges, trenches and ridges were recategorised so a curated
  ocean and a baked sea are one colour and one row. The old "General" row now
  gates only the Moon's surface features and says so.
- **What a reader switches OFF is stored** (`geoid-gis:earth-places-off`),
  never what is on, for the reason the events feed paid for.

**Global rivers are a launch default** (`defaultOn`, half strength) beside the
plate boundaries: a river's name over imagery that does not show the river
reads as a label in the wrong place. They were never behind membership — the
row simply sat unticked in Earth Observation ▸ Hydrology.

Cost, measured on the software renderer at level 5: 360 ms a frame against
342 with every category off, 357 draw calls against 45.

### 13,000 places, and Wikidata's units

The gazetteer is ~13,200 places now: Wikidata summits by prominence and
islands by area, every Smithsonian Holocene volcano ranked into the same
tiers (recency, lifted by height), more cities, lakes and rivers. Batches of
one (tier, category) are detached from the scene while ruled out, so 13,000
names cost nothing a frame (measured 417 ms on the software renderer with
every category on and with every category off).

- **Read Wikidata quantities through `psn:`, never `wdt:`.** `wdt:` is the
  value as typed, in the editor's unit: half the American summits are in
  FEET, and a 13,000 ft hill filled tier 2 as an "8,000 m" peak (530 of
  them, 48 after). `psn:` is normalised to SI -- metres, and square METRES
  for an area.
- **An island's two catalogues anchor it far apart** (Greenland 2.4 deg), so
  the name-clash reach grows with the land's area; longitude is shrunk by
  cos(lat), not divided by it. The clash check is indexed by name stem.
- Workspace > Location labels has a size slider (`setLabelSizeScale`); a
  change clears `_globalVisible`, or the global view's anti-flicker hold keeps
  chips that now overlap. Curated labels are still forced and may overlap at
  large sizes.
## IAU feature outlines on the planets, and the planets' missing pick

Explorer > Locations > Feature outlines (IAU) on the Moon, Mercury, Venus and
Pluto (`gis/nomenclature-outlines.js`, baked by
`services/bake-nomenclature.py`). The gazetteer's outline files are
`<BODY>_nomenclature_geometries[_internal].zip` in its public S3 bucket; the
download page links only the centre points. Mars has none.

- **Mercury's viewer reads longitude WEST-positive**, so its outlines are
  negated before import (`toWestPositive`), measured ~100 deg off before.
  The file on disk stays signed east; the layer's CRS says which it is.
- **No planet viewer published `surfaceLatLonAt`**, so a click on ANY imported
  layer on a planet never opened its card. `port-viewer-seam.py` now writes it
  into all nine: the hit is read back in `GeoID-ImportedGeoLayers`' own frame
  with the viewer's own `vectorToLatLon`, the exact inverse of how the
  vertices were placed, walked onto the relief, answered signed -180..180.
- **Nested outlines pick the smallest** (`layer.pickSmallest`, opt-in in
  `featureInLayer`): a regio holds the planitia that holds the crater, and the
  first containing polygon named Tombaugh Regio for a click on Sputnik.
- **The 180 deg cut is not an edge**: the selection outline skips a segment
  running along +-180, which drew a line across Sputnik Planitia.
- Shapefile export is refused for this layer (it mixes polygons and lines);
  GeoJSON, KML, CSV and GPX work.
- Verify on Pluto (71 features). Looping headless loads of planet viewers
  with the Moon's 9,060 outlines crashed the laptop.
## Transit: plot, lock, run — and the arrival IS the viewer

`transit/transit-render.js` draws it and `transit/transit-sequence.js` runs the
page's half (reveal, gate, arrival, sound, hand-over).

**THE PICTURE IS DRAWN IN A WORKER, and that is the whole of "it glitches".**
The destination viewer loads in a SAME-ORIGIN iframe, which shares the transit
page's main thread; its boot blocks that thread in long stretches (measured on
Saturn: 3.7 s, then 0.8, 0.85 and 0.5 s, all during the chart and the start of
the warp). The first build drew on the main thread and froze with every one.
Now `transit-render-worker.js` draws stars, chart, Earth, flybys, flare AND the
words, brackets and bar on two OffscreenCanvases (the DOM HUD is gone; a
screen-reader line stays), with the worker's own rAF. Measured: the worker kept
producing frames through a 6.2 s main-thread block. The arrival's growth (scale,
fade, blur) is a Web Animation sampled from `approachAt`, so the compositor runs
it through the viewer's second burst of work (1.2–1.6 s tasks as it starts
drawing); only the mask, which opens at the very end, is written per tick. No
OffscreenCanvas: the same renderer runs on the main thread (verified on Mars).
The worker loads its own copies of the page's faces by URL (a worker cannot
see `@font-face`), and takes the page's `?v=` from the script's own src.

A headless screenshot takes seconds here, so it shows a LATER state than the
one read just before it -- that read as a full-size viewer mid-warp, and was
not.

The first version replaced the card and the old warp worker
(`transit-worker.js` is gone). It is mock-up D: the navigation chart with the
destination's name decoded and a ring LOCKING onto it; then Earth falling away
in the corner, the starfield to warp and the worlds between Earth and the
destination sweeping past — every one of them, in order; then the arrival.
Up to three fit the fixed cruise; past that they are spaced 0.8 s apart and
the cruise lengthens to hold them (Pluto passes Mars, Jupiter, Saturn, Uranus
and Neptune, +1.8 s). Everything but the flybys runs on a canonical clock
(`canon()`) that pauses mid-warp for that extra time, so the chart, the
approach and the arrival sound keep their timings.

- **The planet that grows in is the preloaded viewer**, scaled from 0.004 to 1
  about its centre with a blur and a circular mask. The viewers draw their
  globe at the frame's centre, so it lands exactly where the viewer draws it,
  whatever the world, the window or the spin. `globeFraction()` reads the
  globe's radius off the viewer's own camera (Saturn 0.2114 against a hand
  measurement of 0.2115) and the brackets close on that.
- **The mask is the planet plus its rings** (`RINGS`: Saturn 2.35 R, Uranus
  1.7 R), and the viewer's panels are hidden by a class in its own document
  (`tx-arriving`) while it arrives: a ringed planet's circle otherwise takes
  in the sidebar's edge. The mask opens like an iris at the end, which is when
  the panels arrive.
- **The clock HOLDS at the gate (6.6 s)** until the viewer has drawn a textured
  frame (capped 9 s after the reveal), stars still streaming. The arrival
  sound is scheduled when the gate opens, so it lands on the planet however
  long the hold. `GeoIDTransitSequence.current.state()` reads the clock.
- **The shell reads `#viewer-frame[data-crossed="1"]`** as the hand-over now:
  the approach sets opacity 1 on the frame before it has crossed.
- **Under the GeoHUB start screen (`html.is-booting`) or with reduced motion
  the sequence is skipped**: nobody can see it under the start screen, and a
  cold `/?world=` would otherwise hold that screen for nine more seconds.
- **Sound** is synthesised through a 5.5 s hall reverb; it starts on the first
  gesture if the browser will not play before one, from wherever the
  sequence has got to. `geoid:transit-sound` = "off" (or the start screen's
  `geoid:boot-sound`) mutes it.
