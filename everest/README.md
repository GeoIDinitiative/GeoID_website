# ASCENT — Everest

A first- and third-person ascent of Mount Everest, in the browser, built on the
same live tile services a GIS uses. Self-contained: it shares the site's fonts
and the myGeoID viewer skin and nothing else. Nothing here imports from
`GeoID_GIS/` or `myGeoID/`, and nothing there imports from here.

    /everest/index.html          the game
    /everest/dev.html            a harness for the terrain alone
    /everest/game/*.js           ES modules, no build step
    /everest/tests/lint.mjs      stray-backtick + parse check — run before committing
    /everest/tools/              the high-resolution DEM pipeline
    /everest/vendor/three.module.js   three r165, vendored (not the GIS copy)

Run it with the site: `python3 serve.py` from the repo root, then
`/everest/`. There is no build and no dependency install.

**Run `node everest/tests/lint.mjs` before committing.** It catches the two
mistakes this project actually makes: a backtick inside a shader template
literal (which silently truncates the module and fails as a SyntaxError
somewhere else entirely — three times now), and any module that will not
parse. Neither shows up as an obvious failure in the browser.

There is a third failure mode it cannot catch, so check it by hand:
**a shader that will not compile still issues every draw call.** The geometry
count, the uniforms and the bound textures all read correct and the only
symptom is black pixels — `cast` turned out to be a reserved word in GLSL and
cost a long detour through framebuffer readbacks when the answer was one line
in the console. `__drive.shaderErrors()` reports it; read the console first.

---

## What is real and what is not

Worth being precise about, because the whole point of building it on real data
is lost if the line is fuzzy.

**Real, and measured rather than assumed:**

- The **terrain** is [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  on AWS Open Data, decoded from terrarium PNGs, streamed at three
  resolutions (135 m, 17 m and 4.2 m per sample).
- The **imagery** is Esri World Imagery, streamed at four resolutions down to
  0.53 m per pixel under the player.
- The **route** was not drawn. A least-cost path was run over the elevation
  model from Base Camp to the summit — cost = horizontal distance, penalised
  by uphill grade and by steepness, with anything over 58° impassable — and it
  returned the South Col route: 8.14 km and 3,443 m of ascent, up the Khumbu,
  through the Western Cwm, up the Lhotse Face and over the South Col.
- The **camps** sit on flat benches found by searching the DEM for low-slope
  ground at each camp's published elevation near that route. Camp I comes out
  within 6 m of its published 6,065 m and the South Col within 78 m of 7,920.
- The **Western Cwm** was traced by taking the lowest cell on each of fourteen
  north–south transects between 86.876° and 86.915°E — the valley floor,
  found rather than recalled.
- The **surrounding peaks** are local maxima of the DEM, named by matching
  position and height: Nuptse (7,814 measured / 7,861 published), Changtse
  (7,497 / 7,543), Pumori (7,116 / 7,161), Lhotse (8,430 / 8,516).
- The **air pressure** is the barometric formula with a correction for the
  higher subtropical tropopause, giving 33.7 kPa on the summit against 101.3
  at the sea. Inspired oxygen, arterial saturation and the effect of a
  regulator all follow from it.
- The **sun** is a real solar-position calculation for 27.99°N, 86.93°E, in
  Nepal's UTC+5:45, and the **moon** is a real (low-precision) lunar
  ephemeris with its illuminated fraction. The season starts on 28 May 2026
  for a reason: a summit push lands about 2.3 simulated days in, and the moon
  is full on the 31st and 32° up at one in the morning. Expeditions really do
  choose their window partly for the moon.
- **Walking speed** is Tobler's hiking function.
- The **avalanche band** is 25–60° with the peak at 38°, and loading is
  computed from each slope's own aspect against the live wind direction.
- **Wind chill** is the 2001 JAG/TI formula.

**Invented, and marked as such in the code:**

- **Sub-metre relief.** No elevation model of this mountain resolves what you
  are standing on. Two things fill it: a shape-from-shading pass that reads
  the high-frequency part of the 0.5 m imagery's luminance as slope (valid
  over snow, where albedo is nearly uniform, and deliberately weak over rock),
  and procedural snow grain in the last thirty metres — two octaves stretched
  across the wind, perturbing both the normal and the albedo, because on
  frontally-lit snow shading alone is nearly invisible (measured: 1.5× the
  foreground contrast of a flat surface, on a surface that had almost none).
  It is procedural, not a photographic texture set, and neither layer is
  measurement.
- **The fixed line.** The rope, the beaten trail beside it and the wands are
  the config route densified and dropped onto the terrain. The waypoints came
  off the least-cost path; between them it is straight interpolation.
- **The summit cone.** SRTM-lineage data rounds off summits; the measured
  maximum here is 8,749 m against the surveyed 8,848.86. The top 900 m is
  corrected back with a narrow Gaussian. It is the only place any height in
  the game is not what the model said.
- **Crevasses, seracs and snow bridges.** Generated from the DEM's slope and
  along-flow curvature — ice tears where it is being stretched — but no
  dataset says where an individual crevasse is.
- **Everything about the body except the pressure.** The curves are chosen so
  the mountain feels the way the accounts describe it.
- **The other climbers**, and everything they say.

---

## The pieces

| module | what it owns |
| --- | --- |
| `config.js` | every constant, the route, the camps, the peaks, the POI text |
| `geo.js` | geodetic ↔ Web Mercator ↔ local ENU metres, and the tile grid |
| `tiles.js` | one scheduler, one in-flight budget, LRU of decoded images |
| `dem.js` | terrarium decode, despiking, three-tier heightfield, slope/aspect |
| `imagery.js` | four composited imagery windows and their world bounds |
| `terrain.js` | the geometry clipmap and the terrain shader |
| `sky.js` | solar and lunar position, sky dome, the light everything else uses |
| `weather.js` | the jet stream, the state machine, the forecast, snowfall, spindrift |
| `glacier.js` | crevasse generation, the mask that cuts them, ladders, seracs |
| `snowfield.js` | the live snow surface — footprints in, wind fills them back |
| `shadows.js` | terrain self-shadowing by horizon mapping |
| `delight.js` | estimating the imagery's own sun so it can be divided out |
| `postfx.js` | HDR buffer, ambient occlusion, bloom, grade, quality dial |
| `world.js` | camps, route, peaks, POI markers and screen labels |
| `survival.js` | pressure, saturation, energy, warmth, frostbite, inventory |
| `player.js` | movement, crevasse falls, the rope, first/third person |
| `director.js` | slab stability, avalanches, rockfall, and the other climbers |
| `hud.js` | cores, compass, instruments, radial wheel, journal, reader |
| `audio.js` | procedural wind, breathing, crampons — no audio assets |
| `main.js` | boot order, the two clocks, and the loop |

### Two clocks

Real seconds drive animation, the camera, input response and the avalanche.
Simulated seconds — eight per real one (`TIME_SCALE`) — drive the body, the
weather and the sun. Every rate in the simulation is written **per simulated
hour** and converted once, at the top of the function that uses it, so that
changing how fast the clock runs changes *when* things happen and not *how
much* of them happens. Getting this wrong is silent: an early version divided
real seconds by 3600 in the rope-arrest path and the climber hung in a
crevasse losing heat eight times too slowly.

### The clipmap

Nine nested square levels centred on the player, each double the cell size of
the one inside it: 4 m under your boots, 1,024 m at 49 km out. Levels 1–8 are
rings with the middle left out, because a coarse level must not exist where a
fine one covers — a 1,024 m grid interpolates straight across the Western Cwm
and would put a lid over the valley at about 7,000 m.

Three things make it seamless, and all three were bugs first:

1. **Heights are sampled over a grid two cells larger than the one drawn.**
   Without the apron, an edge vertex has no outside neighbour, the central
   difference gets clamped to a one-sided one, and the normal comes out at
   half the true gradient — one row of wrongly-lit vertices around every level
   and every hole. From above it drew the clipmap as concentric squares, which
   reads as cracks and was nothing of the sort.
2. **The outer band morphs toward the parent's surface**, reaching it exactly
   at the edge, so the surfaces are coincident and there is nothing to crack.
3. **The normal's stencil widens to the parent's spacing in that band too** —
   agreeing about where the surface is and disagreeing about which way it
   faces is still a seam.

### The snow surface

Four scales, all faded out by distance so nothing is computed where it cannot
be seen:

- **Sastrugi**, 0.6–3 m, wind-carved ridges — and they *advect*. `windPhase`
  slides the noise coordinate downwind at a few centimetres a minute, so the
  whole ripple field migrates. It is one scalar and it is the difference
  between standing on snow and standing on a photograph of snow.
- **Ripple**, 10–30 cm, rotated 32° out of the sastrugi frame. Value noise
  sits on an axis-aligned lattice, so two octaves in the same frame line
  their grids up and the ground comes out cross-hatched like graph paper.
- **Glitter** — a hashed high-frequency threshold driving a broad specular
  lobe. Snow is a heap of flat crystals and some of them are aimed at you;
  it is the most recognisable thing about sunlit snow up close.
- **The live field** (`snowfield.js`): a 1024 px canvas at **4.7 cm/px** over
  48 m that follows the player. Boots write footprints into it; wind and
  snowfall fill them back in at a rate set by the weather. The terrain shader
  reads it for both normal and albedo.

Two things that had to be got right: the resolution is set by the smallest
thing being recorded, not by the extent — at 0.25 m/px a boot was **one
pixel** and 128 strides left 128 disturbed pixels, invisible. And the field
*scrolls* rather than re-centring, blitting itself at an offset, so walking
keeps the history instead of erasing it.

### Three things about light that are counter-intuitive

Each of these was wrong first, and each was wrong in a way that looked like a
rendering bug rather than a modelling one.

- **Cloud over a glacier is bright, not dark.** Dimming everything under
  cloud made a storm render as dusk. What happens is the opposite: the sun
  goes, the whole sky becomes one diffuse source, and light bounces between
  cloud and snow until it arrives from every direction with no shadow
  anywhere. That is what a whiteout *is* — too much flat light, not too
  little. Directional down, ambient up.
- **A crevasse wall is dark even at the lip.** A vertical face at the top of
  a slot sees about half the sky, sees it at grazing incidence, and is ice,
  which reflects roughly a third of what snow does. Under a tenth of the
  brightness of the ground you are standing on. Starting near 1.0 is what
  makes crevasses look like blue lines painted on the glacier.
- **Light falls into a slot over metres, not over a fraction of its depth.**
  An eighty-metre crevasse with a fraction-based ramp is still two-thirds lit
  through the top twenty metres, which is the only part anyone can see. The
  scale length is set by how wide the slot is.

### Cutting a hole for a crevasse

Not in the geometry — the clipmap is rebuilt every time the player walks 8 m.
`glacier.js` paints a 1 m/px mask around the player and the terrain shader
discards fragments inside a crevasse; the trench walls are separate geometry
drawn behind, with their colour baked as radiance rather than lit, because any
diffuse model paints the far wall of a slot as brightly as the open glacier
and forty-metre crevasses come out as pale ribbons lying on the snow.

The field never opens a hole under a player who is already standing there: the
ground they are on has just demonstrably held their weight, so it is a bridge.

---

## The vertical lines on the mountains

Worth writing down because it took four wrong answers to find, and three of
them were wrong *measurements* rather than wrong guesses.

They were **tile seams in the Esri mosaic**. World Imagery stitches tiles from
different satellite passes on different days, each with its own exposure, so
there is a brightness step down every join — and since a tile is 256 px, the
joins are evenly spaced, which is what made them read as a deliberate screen
overlay rather than as data.

The wrong turns, and what each one taught:

1. **Film grain.** It really was aliasing into columns — `fract(sin(dot(p,k)))`
   loses precision in a way that correlates along one axis — so removing it
   was correct and did not fix the problem.
2. **"The imagery is clean, ratio 0.93."** Measured with adjacent-pixel
   differences, which is *blind to bands*: neighbouring pixels inside a
   20-pixel stripe agree perfectly. **Bands have to be measured as bands** —
   detrended column means, not pixel deltas. Re-measured that way, every fine
   tier had ~2× more vertical band energy than horizontal.
3. **Orthorectification smear on steep faces.** Plausible, and there is some,
   but the decisive test was periodicity: the step across a 256 px boundary is
   **2.74× the step anywhere else**, while JPEG's 8 px block grid is 1.05.
   Evenly spaced at exactly the tile pitch is not a physical process.
4. **A row-offset plus a column-offset.** Fixed the 4×4 tiers and left the 7×7
   mid tier untouched, because that model is rank-1 and 49 independent
   exposures are not.

The fix is `levelTiles` in `imagery.js`: measure the step across each seam
*segment* as the **median** of per-line differences (a mean over a whole
1,792 px column is swamped by real terrain — valley at one end, summit at the
other), then relax one offset per tile by Gauss-Seidel until the seams agree,
re-centre, clamp, and apply. Ratios went 2.74 → ~1.1. Runs once per tier
build, in the same canvas read/write as the fine column-mean de-stripe.

### The final answer: the horizon-map shadows

Found by magnifying raw framebuffer crops 3× and A/B-ing one system at a
time on screen — not by the band detector, whose favourite window turned out
to be the mountain's own skyline.

The needles were the **terrain self-shadowing terminator**. Each 33.6 m texel
of the horizon map stores the elevation angle of the highest foreground ridge
toward the sun, from a 32-step geometric ray march. Across a sharp crest,
adjacent texels' marches hit or miss it, their horizons disagree by more than
the shader's 0.024 penumbra, and the shadow boundary renders as alternating
lit/shadowed columns: evenly spaced needles (~20 px at 3 km), in a band (the
terminator), controlled by the foreground hills (they are the occluder),
worst at low sun. The one clean toggle-test of this flag returned 0% because
it ran pre-dawn, when the direct term the shadow multiplies was already zero
— a toggle proves nothing when the thing it gates is off.

Shadows are now off (`u.shadowsOn.value = 0` in main.js). The imagery already
carries the mountain's real shadows, baked in at capture; the reference
viewer ships exactly that and no more. The machinery stays for a future
16-bit, supersampled, wide-penumbra horizon map.

Two other real artifact sources were found and removed on the way — the
`destripe` column-mean pass (writing per-column offsets into the imagery) and
the photoclinometry sweep (streaks along the integration rays) — plus one
genuine aliasing fix that survives: coarse clipmap rings now low-pass the
height field to their own Nyquist (3×3 box per cell) instead of point-sampling
it, which removed the cell-frequency shading fingers from the distant faces.

### The sixth answer: it was not in the game

Ordered last because it is the true one, and because five real defects were
fixed on the way to it without any of them being the reported artifact.

The lines were an artifact of **the embedded preview pane**, not of ASCENT.
The pane rendered 1152 px of page and the surrounding application displayed
that in roughly 1089 px, and a non-integer rescale of a detailed image beats
against the pixel grid at exactly the observed spacing. Opening the same build
in an ordinary browser window at 100% zoom drops the measured banding
amplitude from **4.9 to 0.62** — an eight-fold reduction with no code change
between the two readings.

Three measurements, all from `game/diag.js`, close it:

1. **Everything inside the canvas is terrain-locked.** Rotating the camera in
   two equal steps shifted the pattern's phase by 6.79 and 6.46 px — it moves
   with the mountain. A screen overlay does not do that. What the detector had
   been measuring all along was rock.
2. **The canvas is pixel-exact with its CSS box** in both environments, and
   `visualViewport.scale` is 1. Nothing inside the page rescales anything.
3. **No rendering subsystem removes it**, because there was nothing in the
   render to remove.

The methodological lesson is the expensive one, and it is not "read the
console". It is:

> **Establish the noise floor before believing any difference.**

Twelve identical, unchanged frames varied by 17%. Every "cause" diagnosed
between the third and fifth attempts produced drops of 8–17% — entirely inside
that noise — and each was reported as a finding. A measurement whose
repeatability has never been checked is not evidence, and three consecutive
wrong answers were built on one.

The second lesson: **measure the surface the user is looking at.** `readPixels`
returns the drawing buffer, which is upstream of the compositor and upstream of
however the host application chooses to paint the result. A clean framebuffer
is not a clean screen.

### The fifth, which was real and was also not it

The seams were real and fixing them was right, but they were not what the
screenshots kept showing. **The canvas was being rescaled by the browser.**

`Game.resize` set the drawing buffer to `min(devicePixelRatio, quality.maxPixelRatio)`.
On a dpr-2 display at quality "high" that is 1.5, so the canvas held 1.5 device
pixels per CSS pixel while the screen had 2, and the compositor upscaled the
finished frame by 4/3 on the way to the glass. A non-integer rescale beats
against the pixel grid: at a ratio of 1.029 the beat period is **exactly 35 px**,
which is the spacing in the report.

Two things made this survive five rounds of investigation:

- **`gl.readPixels` cannot see it.** The resampling happens downstream of the
  drawing buffer, so every framebuffer measurement — including a clean spectrum
  over ten camera angles — was structurally incapable of detecting it.
- **It is inert at devicePixelRatio 1**, which is the development display.
  `min(1, 1.5) = 1`, exact, no artifact, ever.

The lesson is narrower than "read the console": *measure the surface the user
is actually looking at.* A framebuffer is not a screen.

The pixel ratio is no longer a quality knob. The canvas is always exactly
`devicePixelRatio`; the cost `maxPixelRatio` used to buy now comes out of the
internal HDR target via `PostFX.setSize(..., budget)`, which is one filtered
blit we control. Identical pixel count, no compositor rescale. Quality "low"
renders directly with no chain to scale, so there the ratio snaps to an integer
submultiple — those map whole pixels to whole pixels and cannot beat.

## Relief the elevation model does not have

`tools/dem_information.mjs` builds the height grid at each zoom and subtracts a
bilinear upsample of its parent; what survives is what that level actually
knows:

```
z11  67 m/px   30.07 m RMS   real detail
z12  34 m/px   11.79 m       real detail
z13  17 m/px    7.69 m       real detail
z14  8.4 m/px   1.26 m       marginal
z15  4.2 m/px   0.74 m       interpolation, nothing more
```

**The elevation data stops at 17 m.** The source over High Mountain Asia is
30 m SRTM/ASTER and everything below z13 is the publisher's resampling. The same
test against Esri imagery says z18 (0.53 m/px) is genuine and **z19 is an
upsample** — so there is a factor of thirty between what can be seen and what
can be stood on, and no shader closes it. A shader only shades the surface it
is given.

`photoclino.js` recovers some of it from the picture. For a Lambertian surface
the brightness residual gives the slope **along the sun azimuth** —
`(I − B)/B ≈ −(Lh·∇h)/Ly` — and the capture sun is already estimated for
de-lighting. Integrating that slope along the azimuth with a leaky accumulator
(leak length = 17 m, so this is a high-pass by construction and the DEM keeps
authority above it) gives a height field, not a normal perturbation. Measured:
**0.78 m RMS** of recovered relief, +10.4% structure in the 8–32 px band, 93 ms
per rebuild at 768², no measurable per-frame GPU cost.

Two details that matter:

- **It displaces vertices, not just normals.** A perturbed normal shades a flat
  surface: the silhouette stays smooth and the illusion dies at a grazing
  angle. Geometry breaks the skyline. It is also crack-free across clipmap
  levels for free, because the lookup is by world position and a shared vertex
  gets one answer whichever level asks.
- **`Heightfield.height` adds the same field**, so the ground the player stands
  on is the ground the shader draws — verified identical to 1e-6 m. The camps
  are re-snapped when the relief first lands, or a third of Base Camp floats.

This is not a substitute for a real DSM and is not described as one. Albedo and
shape are genuinely confounded in one image; what keeps it honest is the leak,
the ±3 m clamp, and dropping the gain off snow, where the Lambertian assumption
stops holding. Under it all the geometry is still 17 m. For comparison,
RealityMaps' Everest runs on `dsmKhumbu` — quantized-mesh at z18 over a
17 × 26 km footprint, roughly 1 m, purpose-flown. Closing that gap needs an
8 m or 2 m Himalayan DEM from NSIDC, which needs an Earthdata login;
`tools/make_dem_tiles.py` already cuts a downloaded GeoTIFF into terrarium
tiles for exactly that.

## Lighting

**Terrain shadows are horizon-mapped, not shadow-mapped.** For the sun's
current bearing, every point stores the elevation angle of the highest ground
along it; a point is in shadow exactly when the sun is below that. One texture
fetch, no cascades, no depth bias, correct to 28 km. It suits this scene
because caster and receiver are the same heightfield and the shadows that
matter are kilometres long — Nuptse across the Cwm, the Lhotse Face until
mid-morning. Rebuilt when the sun moves 3°, spread over frames.

**The imagery is de-lit.** Esri's tiles have the satellite's own sun baked in,
so draping and re-lighting them multiplies two lightings together and leaves
pits that are black at every hour. `delight.js` sweeps sun directions,
correlates the predicted hillshade against the picture's luminance over a few
thousand snow samples, and divides the winner out — it recovers azimuth 125–140°
at 50–60° elevation with r ≈ 0.4, which is a credible mid-morning pass over
Nepal. Clamped, trusted only over bright ground, and what it cannot recover it
lifts rather than amplifying compression noise into confetti.

## Verifying it

`dev.html` is the terrain on its own — if the mountain is wrong it is wrong
there first, with nothing else in the way. Both it and the game expose a
driving hook, because **`requestAnimationFrame` does not fire in a browser tab
that is not compositing**, so a headless check has to step the loop itself and
read frames back out of the WebGL context.

    http://localhost:8123/everest/?shot=1

gives you `window.__drive` with `run(n)`, `settle(ms)`, `teleport(lat, lon)`,
`setHour(h)` and `snap(name)`. `snap` POSTs a JPEG to `http://127.0.0.1:8199/`
— run any small sink there to collect them. Without `?shot` the drawing buffer
is not preserved and none of this exists.

Measured at 1920×1080 on an **integrated Intel Xe**, GPU time via
`EXT_disjoint_timer_query` (CPU time is ~2 ms and is not the constraint):

| quality | GPU ms | of a 60 fps frame |
| --- | --- | --- |
| low / medium | 6.0 | 36% |
| **high** (default) | **9.3** | 56% |
| ultra | 13.0 | 78% |

Profile before optimising. An earlier measurement of "1.3 ms" was CPU only —
frame cost appeared to *fall* from 720p to 4K, which is impossible, and was
the tell that the GPU was running behind unmeasured.

Draw calls are worth watching. Tents, route wands and seracs were built as a
Group of Meshes each and took the scene from 134 calls to **522** — more than
everything else put together, for props that never move. All three are
`InstancedMesh` now (125 calls, 1.31 ms), which is faster than before any of
them existed.

### Skin

The palette is `/styles/viewer-skin.css` — the myGeoID magenta-and-cyan — and
the control bar across the top is the shell's: clock, season day, every
toggle, altitude and standing in one strip. Each button carries the shortcut
that does the same thing and both come through `Game.tool()`, so a lit button
and the key that toggles it cannot drift apart.

Two overrides on the skin, both in `everest.css` and both explained there:
its `body::after` CRT overlay is turned down (48% purple vignette and a
1-in-3 scanline mask over a full-screen 3D scene reads as *low resolution*,
which is the opposite of what it is for), and the scene canvas opts out of
the skin's `saturate(1.18)` because satellite imagery is already graded.

Canvas-drawn parts of the HUD (cores, compass, item wheel) restate the
palette as constants at the top of `hud.js` — a 2D context cannot read a CSS
custom property, and that is the only place in the project where the colours
are written twice.

---

## Licence and attribution

**Imagery** — Esri, Vantor, Earthstar Geographics and the GIS User Community.
Free of charge on `server.arcgisonline.com` and **not** licensed for
unrestricted embedding: the item record puts it under the Esri Master License
Agreement and states it is not intended for offline tile export. Streaming
what a player is looking at is viewing, and that is all this does — nothing is
cached to disk. Anything beyond a demo should go through ArcGIS Location
Platform with a key. This is the same position `GeoID_GIS/viewer/gis/tile-sources.js`
takes on the same service.

**Elevation** — Mapzen Terrain Tiles on AWS Open Data: SRTM, ASTER, and
national datasets, each under its own terms.

This is a game. It is not a route description, a training aid, or advice of
any kind about a mountain that has killed more than three hundred people.
