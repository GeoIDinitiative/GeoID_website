# Mars Flight Simulator — GeoID Explorer

A flight simulator built **on top of the full Mars viewer**. It is a fork of
`/planet_explorer/mars/viewer/` — same collapsible navigation panel, basemap
picker (CTX mosaic streaming, Viking color, TES, hillshade, DEM…), hierarchical
overlays (geology, minerals, surface conditions), optional place-of-interest
labels, search, starfield and audio — plus a pilotable spaceship.

## Files

| File | Role |
|---|---|
| `index.html` | Fork of the viewer page. A `<base href="/planet_explorer/mars/viewer/">` tag makes every relative asset URL resolve into the real viewer directory, so **no assets are duplicated**. Adds the Flight Simulator nav section + HUD. |
| `mars-viewer.js` | Fork of the viewer engine. All changes are marked with `FLIGHT-SIM` comments: absolute module imports, a 1:1 terrain-relief override, render-loop handoff to the flight model, and a `window.__flightSimHooks` export. |
| `flightsim.js` | The flight module: ship, physics, chase/cockpit cameras, HUD, keyboard input. Called once per frame by the viewer render loop. |
| `serve.py` | Dev helper — serves the **site root** on localhost and opens the sim. |
| `mars_flight_sim.html` | Legacy URL → redirects to `index.html`. |

## Run it

```bash
python3 serve.py
```

then open http://localhost:8000/flight_sim/mars_flightsim/ (opens automatically).
Any static server rooted at the repository root works. Direct `file://` launch
is not supported (same as the viewer).

## Flight mode

Open the **Flight Simulator** section in the nav panel and flip the toggle.
The sim then:

1. Switches the basemap to **CTX Mosaic (Color)** — ESRI CTX tiles streamed on
   demand, colorized with the Viking global mosaic (you can switch basemaps
   while flying; overlays and labels keep working).
2. Forces terrain relief to **1:1 scale** (no vertical exaggeration — real MOLA
   DEM heights on a to-scale globe, ~29.4 km of total relief on a 3 396 km
   radius). Exiting flight restores the normal viewer relief setting.
3. Spawns the ship above whatever point the camera was looking at, at the
   selected launch altitude, heading due east.

| Key | Action |
|---|---|
| `W` / `S` | Throttle up / down |
| `↑` / `↓` | Pitch |
| `←` / `→` | Roll |
| `A` / `D` | Yaw |
| `Shift` | Boost (limited energy, recharges) |
| `Space` | Brake |
| `C` | Chase / cockpit camera |
| `R` | Re-level (heading east, cut speed) |
| `H` | Hide / show HUD |
| `Esc` | Exit flight mode |

The HUD shows altitude above local terrain, ground speed, heading, lat/lon,
named region, throttle and boost meters.

**Flight speed** — at true scale a 2.4 km/s ship takes ~90 minutes to cross the
hemisphere, which reads as standing still from 30 km up. The default is ×10
("Brisk"); switch to ×1 (Realistic) or ×50 (Arcade) in the panel. The
multiplier scales airspeed only — distances, altitudes and terrain stay 1:1.

## Surface detail (tile resolution)

CTX ground resolution by tile level (each level doubles the detail below it):

| Level | Resolution | Coverage |
|---|---|---|
| 12 | ~5 m/px | CTX native max. Patchy (Jezero, Gale, parts of Elysium). |
| 11 | ~10 m/px | High, broad coverage — reliable "sharp". |
| 10 | ~20 m/px | Medium, near-universal. |
| 9 / 8 | ~40 / ~80 m/px | Coarse. |
| 5 | ~650 m/px | Pre-warmed "instant" base layer. |

Levels 13–17 are advertised by the service but return 404 everywhere — no tiles
above the native 5 m/px were ever built, so **12 is the hard ceiling**.

The **Surface detail** control in the flight panel sets the ceiling. Detail is
always adaptive by altitude (coarser up high, sharpest on low passes); the
setting caps how sharp it goes near the ground:

- **Light** — up to 40 m/px (level 9)
- **Adaptive — up to 20 m/px (level 10)** — *default.* Fast, universal
  coverage, consistent surface, no wasted level-11/12 fetches.
- **High** — up to 10 m/px (level 11)
- **Native** — up to 5 m/px (level 12), where CTX has coverage

The altitude curve (at the chosen ceiling C): ≤15 km → min(C,12); ≤40 km →
min(C,11); ≤90 km → 9; ≤220 km → 8; higher → 7. Changing the control re-plans
tiles live; already-loaded sharper tiles are kept.

## The ship

A Space Shuttle orbiter (Challenger), built to STS proportions — 37 m long,
24 m span, 14 m tall, nose pointing -Z. Modelled features: double-delta wing
with the strake kink, black HRSI thermal-protection belly and RCC nose cap,
swept vertical stabiliser with split rudder/speedbrake, OMS pods flanking the
tail, payload-bay door seams, six-window crew module, body flap, elevons, and
three SSME bells in the classic triangle (one high centre, two low outboard).
Markings are canvas decals on flat planes: "UNITED STATES" down both sides of
the payload bay, US flag on the left wing and "USA" on the right, as flown.

The forward fuselage is **one continuous lathed surface**, not stacked cones —
a shared `[z, radius]` profile is revolved to give the long, finely drawn nose.
Cone sections left visible steps where their radii met and read as a blunt
slab. The same profile drives a partial revolve (phi centred on world -Y) for
the black TPS along the underside, so the white skin, the black belly and the
RCC nose cap all share exactly the same silhouette.

The black belly on the mid and aft body is a partial-cylinder shell: after
`rotation.x = π/2` a CylinderGeometry's `theta = 0` points at world -Y, so a
band centred there is the underside. Decal planes use ±90° Y rotations so the
lettering reads correctly from whichever side faces the viewer — note that a
`rotation.z` on a top-facing decal mirrors the text, which is why the wing
markings have none.

**Engine plumes** are layered rather than a single cone: three nested
open-ended cones (hot white core → blue mid → faint wide halo) with additive
blending so the overlaps brighten naturally, four Mach shock diamonds spaced
along the axis, and a soft radial sprite at each nozzle throat. Everything is
driven by `setThrustVisuals(level, boosting)`: the plume stretches with
throttle while its apex stays pinned at the nozzle, diamonds only appear above
25% thrust and pack tighter as thrust rises, and the whole thing shifts to
orange under boost. The plume follows commanded throttle rather than achieved
speed, so the engines respond the instant you move the throttle.

**Ship display size** — at true scale the 37 m orbiter is nearly invisible
against a 3 396 km planet, so the default is a 600 m "cinematic" display scale;
switch to Realistic (37 m) or Arcade (6 km) in the panel. Physics and ground
clearance follow the displayed size; flight dynamics are unaffected.

## Notes

- **Basemap and terrain relief use the stock viewer controls** — the Basemap
  and Relief section, exactly like the normal viewer. The Terrain relief slider
  is live **in every mode including the CTX mosaics**, which the stock viewer
  force-flattens to zero with the slider disabled; here both the base globe and
  the draped CTX tiles follow it, so vertical exaggeration is adjustable while
  CTX imagery is active. Engaging flight sets it to true 1:1 scale (0.028).
  Switching basemaps mid-flight works. Disengaging restores your previous
  relief value. Viewer overlays (geology, minerals, contours, labels…) all work
  mid-flight.
- **Global tile pre-cache** — on page load a background warmer fetches every
  CTX tile for levels 0–5 (~2 700 tiles, one time per device, resumable) into
  the service-worker cache, so first flights over new terrain start with
  moderate resolution everywhere instead of the blurry global basemap. The
  panel shows its progress; finer levels still stream live as you fly.
- Flight collision uses the same elevation sampler as the viewer (upscaled MOLA
  DEM) plus the CTX tile drape lift. Ground clearance scales with the ship's
  display size so the hull never buries into terrain. Shallow contact skims;
  a steep, fast impact (vertical speed above ~450 m/s × speed multiplier)
  triggers a crash sequence — explosion, camera shake, and an automatic
  redeploy 8 km above the impact site.
### CTX terrain rendering in flight

Orbit mode uses the viewer's *focus-overlay* streamer: CTX tiles are composited
into one equirectangular canvas draped over the whole globe. That works for a
top-down orbit view but dilutes badly in flight, where a horizon-facing chase
camera spans hundreds of km — everything reads as a blurry smear.

Flight mode instead activates the viewer's **draped detail-tile streamer**
(`CTXDetailPatchStreamer`), which was dead code in the stock viewer — the
render loop unconditionally deactivated it. It builds one textured mesh per
CTX tile with quadtree LOD: fine tiles near the ship, coarse in the distance,
each draped over the 1:1 DEM. Making it work required fixing several bugs that
had never surfaced while it was disabled:

- `_getFocusTileRange` was called by `_buildBgTileGrid` but only existed on the
  other streamer class — background tiles threw on every frame.
- The fallback floor was `max(activationMinLevel, level - 3)`, which **exceeds
  the requested level** for coarse background tiles (level 5-8 vs a floor of
  9). The `while (level >= minLevel)` loop then exited immediately and returned
  null without ever issuing a fetch, so background coverage never rendered.
  The floor is now clamped to never exceed the requested level, and descends
  all the way down so sparse-coverage regions land on their best imagery.
- In-flight fetches were aborted on every state change. Since the desired tile
  set shifts continuously with the moving ship and 404-fallback chains take
  >1 s, no fetch ever completed. Aborts are now suppressed while flying.
- 48 concurrent fetches exhausted the browser socket pool (every request
  failing with "Failed to fetch"), and those failures were written to the
  permanent blank-list, poisoning tiles that were actually fine. Concurrency is
  now 16, and a long run of null payloads is treated as a network outage:
  the blank-list is cleared and the streamer backs off for 8 s.
- Detail tiles are grayscale CTX; on the "CTX Mosaic (Color)" basemap they are
  tinted per-tile with the matching Viking mosaic region.
- The settle gate (350 ms motionless) is bypassed in flight, and `depthTest` is
  on so the ship occludes correctly against terrain.

**The real resolution ceiling is level 12 = 5.09 m/px**, which is CTX's native
imaging resolution. The service's `tileInfo` advertises LODs 0-17 and the
startup probe reports `workingMaxLevel: 17`, but that is not true of actual
tiles — every request at level 13 or deeper returns HTTP 400 anywhere on the
planet, because there is no more detail to serve and those LODs were never
built. This matters for throughput, not just correctness: `_chooseLevel`'s
altitude kickers ask for 14-17 at flight altitude, so with a higher cap *every*
tile request walked a doomed fallback chain (17→16→15→14→13, all 400) before
reaching real imagery — four wasted round trips per tile. The cap is now the
true ceiling, so the first request already targets the sharpest tile that
exists. Coverage at 12 is patchy (present over e.g. Jezero and Gale, absent
over much of the planet); the fallback resolves those areas to 11 (10 m/px) or
10 (20 m/px).

**Concurrency is 6, not 48.** Every tile comes from one host, and browsers cap
connections per host at ~6. A higher limit buys no parallelism — the surplus
sits in the browser's own queue while the streamer believes those fetches are
active, so its queue never drains and new tiles wait behind stale ones. With 16
in flight the streamer resolved 3 tiles in 25 s with 215 queued; at 6 it
resolved 103 in 10 s with the queue fully drained. The global cache warmer is
also fully suspended during flight, since it competes for the same connections.

**Flight tiling is CONCENTRIC HIERARCHICAL RINGS** centred on the ground point
ahead of the ship — the same idea as the UI's zoom-based LOD. The immediate
field of view gets the finest level; rings grade coarser outward to the horizon:

- `_flightCenterLevel(shipAlt)` picks the finest level from the **ship's**
  altitude (not the chase camera, which trails tens of km higher and would
  force everything coarse): ≤6 km → 12, ≤15 km → 11, ≤35 km → 10, ≤80 km → 9, …
  clamped to the user's **Surface detail** ceiling (default Native = 12).
- The ring builder emits an N-tile grid at each level from the centre level down
  ~4 levels, all centred on the focus. Because coarser tiles are bigger, each
  lower level's grid nests around the finer one — sharp core, softening outward.
- Enqueue priority `−level*4 + dist2` loads the finest centre tiles first, so
  the ground under the ship sharpens almost immediately; coarser rings fill in
  behind. Requests resolve via fallback, so levels that 404/500 in a region
  (e.g. **7 and 8 both return HTTP 500** across 89/137/230°E) are skipped and the
  tile lands on the finest that works. Render order (finer on top) + LRU
  visibility hide the coarse tiles wherever a finer one covers.

The instant level-5 layer (from the warm cache) still underlays the far horizon.
The old flat single-level near patch and the separate "medium ring" — both of
which flattened the hierarchy into one uniform (low) level and, for the medium
ring, flooded the queue with doomed broken-level requests — were **removed**.
The DFS detail layer is disabled in flight (the rings replace it).

**Near-field background grid.** `bgLevel` is derived from the view bbox, which
in a horizon-facing chase view spans hundreds of km — spreading the ~300-tile
budget across all of it only buys level 8 (81 m/px) even when level 12 exists
directly under the ship. During flight the background grid is instead built
over a tight footprint around the ship (~1.5× altitude), taking the sharpest
level whose grid fits the tile budget, counted down from the stage level. The
footprint has to stay tight: a wide one cannot fit level 12 inside the budget
(~625 tiles needed against a 420 cap) and silently settles for level 10. The
surrounding area is covered by the instant and coarse layers. Measured over
Jezero at 8 km: 188 level-12 tiles (5 m/px), against level 8 (81 m/px) before.

**Eviction leak (the big one).** The stock rule protected *every* tile coarser
than the stage level from eviction ("keep all coarser tiles as placeholders").
That is fine for a stationary zoom, but a moving ship never stops generating new
coarser tiles, and none of the old ones were ever "≥ stage level", so they were
all protected forever. The mesh set grew past **2 300 tiles against a 700
budget** — a memory leak that also starved the near-field fetches: with only ~6
connections, the streamer spent them re-confirming thousands of stale tiles
instead of loading the sharp ones under the ship. During flight, coarser tiles
are now kept only while they still intersect the viewport; tiles left behind the
ship are evicted. Measured: the mesh set dropped from 2 301 to a steady ~115,
and the ground directly under the ship went from level 10 (stuck) to level 11 —
the finest CTX actually publishes in that region.

**Flicker.** The stock rule drops `_smoothedStageLevel` to the desired level
immediately on any decrease, then climbs back one step at a time. In flight the
desired level jitters constantly (altitude wobble, and the view bbox comes from
a raycast against moving terrain), so the level snapped down and crawled back
up over and over — that was the resolution flicker. Downward changes now need
to persist (900 ms for a single level, 250 ms for a 2+ level drop) before being
followed. The `largeAreaChange` reset — which wiped in-flight fetches and
restarted the coarse→fine climb from three levels down, something a moving ship
triggers regularly — is also suppressed during flight. Measured: the stage
level held steady across 20+ seconds of flight with zero reversals.

**Lookahead** — the streamer's refinement focus leads the ship along its
heading by ~6 s of travel (capped ~0.9°), so tiles load *before* the ship
arrives rather than only under it. This is the practical answer to "the ground
under us loads but the front doesn't." It cannot beat the network, though: with
~6 connections per host and a slow region (~1.25 s/tile near 90°E), high speed
still outruns the imagery — fly ×1 for fully-covered sharp flight.

Global pre-caching at flight resolution is **not possible**: level 10 is ~2.1M
tiles ≈ 230 GB, level 8 ≈ 14 GB, both far past the browser's ~3.5 GB storage
quota. Only the coarse levels 0–5 (~200 MB) can be warmed globally, which is
what the instant base layer already does.

**Immediacy** — a third "instant" tile layer is enqueued ahead of everything
else at level 5, which the background warmer has already cached globally, so it
returns from the service worker in ~5 ms and paints the whole viewport on
arrival instead of leaving it blank. The adaptive background level (usually
7-9) and the fine detail level then refine on top. Tiles still take a moment to
sharpen over never-visited terrain — slow down or fly ×1 for maximum detail.

**Smoothness** — several per-frame costs were cut for flight:

- Mesh creation is capped at 3/frame while flying (the forced-settled camera
  would otherwise take the 8/frame branch: 8 geometry builds + 8 texture
  uploads in one frame is a visible hitch).
- Tile geometry uses 20×20 segments instead of 36×36 — a third of the DEM
  sampling work, no visible loss at tile scale.
- Viking colorization moved from per-tile CPU canvas compositing (2 canvas
  allocations + 3 filtered draws each) to a GPU shader multiply in the existing
  shared tile program.
- Changing terrain relief used to rebuild every tile geometry synchronously
  (~1 s at a few hundred tiles) and re-anchor all labels, contours and geology
  linework (~250 ms) — on *every* slider input event. Geometry rebuilds are now
  queued and spread over frames, and the re-anchor pass is debounced to the end
  of the drag. A slider drag now costs ~0.1 ms per event.
- Search/tour fly-to animations and the moon viewer assume orbit mode; entering
  the moon viewer auto-exits flight mode.
- To pull upstream viewer improvements into the fork, re-copy
  `planet_explorer/mars/viewer/mars-viewer.js` and re-apply the blocks marked
  `FLIGHT-SIM` (grep for that tag in this directory's copy).
