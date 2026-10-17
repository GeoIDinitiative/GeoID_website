# Drawing, extent picking, the tool registry, extraction, buffers, shapefile export

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## "Which patch of ground?" is asked once — `extent-picker.js`

**Workspace and the fetchers are one loop, in both directions.** Every
extent select — the Atmosphere tab's `#gee-extent`, the GEE dialog's
`#gee-add-extent` AND the weather card's `#weather-extent` — passes
`{ allLayers: true }`, so any loaded Workspace layer (an uploaded
shapefile, a catalogue tick, a drawn shape) is offered as an extent by its
bounding box. And the reverse: a GEE pull whose extent is the LIVE drawn
overlay calls `persistExtent(..., { mark: "fetchExtent" })` on success —
the weather card's keep-the-ground rule — so the shape becomes a named,
project-registered Workspace layer ("Fetch extent W×H°", ▱-listed in the
selects, idempotent by shape) and the floating overlay stands down.
Guarded on `drawnOverlayBounds()`: an extent chosen from a named layer has
no overlay, so nothing double-captures. Verified end to end with a mocked
service: fetch over a drawn box → "Fetch extent 5.0×4.0°" lands in
Workspace, is offered ▱-marked in the extent select, and resolves back to
its own ring.

The weather card grew a good answer to that question and Earth Engine had a
third of one: a "Drawn polygon" option that read the live overlay and
**returned null** when there was not one — a dead end wearing the clothes of a
control, with the status line saying nothing. `gis/extent-picker.js` is the
weather card's answer lifted out so both ask it. Not copied: copied is how the
polygon-area formula came to be wrong in ten files and how the credit and
licence lines came to describe different maps.

The fallback chain is the whole point, and every step of it fails silently
without one: the live overlay, else the last CAPTURED extent still visible on
the globe, else arm the Draw tool and say so. Above that, any drawn polygon
still on the globe can be chosen BY NAME (`layer:<id>`, listed as "▱ Drawn
area 1"), so re-running a dataset over the same box next week is a choice
rather than a guess about which one a fallback would take. A `layer:` id whose
layer has been removed is an ERROR, not a silent resolve to undefined that
lets the request go out global. A hidden polygon is never the fallback — it is
not on the globe to be reused.

**It fixed a real longitude bug in gee.js.** `requestBounds` read the viewer's
`getExtractionGeometry` and passed those numbers straight through, but the
viewer carries **east-positive 0–360** — so a polygon over the Atlantic asked
Earth Engine for a bbox at longitude 315, the middle of Asia. Same trap
`signedLon` in bridge.js exists for; the conversion is inside the picker now
and `extent-picker.test.mjs` pins it (`resolvePolygonExtent` over a 350–355°
overlay must answer −10 to −5).

**A modal covers the globe, so "draw an area" cannot be done WITH the dialog
open.** The GEE dialog's ✏ button therefore arms the tool, stands the dialog
down, and holds the dataset, dates and tab subject in `pendingDialog` — so
reopening comes back to what you had, with the extent preselected to the shape
you just drew and the status saying "Using the area you just drew." Losing a
chosen dataset because somebody drew a box is exactly the side quest the
weather card was built to avoid. Verified live: SMAP + 2026-01-05/2026-02-05
survived the round trip, extent came back "drawn".

The Atmosphere tab's own `#gee-extent` gets the same list and the same
arm-on-select, because "any GEE pull" means that control too. Its option was
renamed `polygon` → `drawn`; `resolvePolygonExtent` accepts BOTH spellings, or
the rename would have broken the tab it was meant to improve. The GFS card
(`gee-live.js`) is deliberately untouched — it already has a broader picker
listing every vector layer, plus its own draw button.

**The GFS forecast (Earth Engine) subsection is GONE**, removed from the
panels.js MARKUP — the one source all ten worlds render from, so one edit
removed it everywhere. Its checked-first precondition held: `gee-live.js`
guards every control lookup (`if (!select) return`, `?.` throughout) and
nothing else reads `gee-gfs-*`, so no hidden-input dance was needed — unlike
`geology-structures-toggle`, which earth-viewer reads unguarded. The module
stays for its pure, unit-tested half; its wiring no-ops without the card.
What the card uniquely had — a DRAW-AREA button — moved to the Atmospheric
datasets section as `#gee-draw-area`, wired in gee.js: one press arms the
Draw tool, points `#gee-extent` at "drawn", and the next Request uses the
shape. The button is the GFS card's own TWO-PRESS
gesture, kept exactly: first press with nothing drawn arms the tool and says
"press this again to claim it"; second press CAPTURES the shape as a layer
named "Earth Engine fetch area" (Vectors & Shapes, project-restorable,
idempotent by shape), points the extent select at that layer by name, and
reports the bounds to the status line. And the extent select keeps the GFS
card's other rule — **every loaded vector layer is a possible extent**, not
only drawn shapes: `refreshPolygonOptions(select, fallback, { allLayers })`
lists them after the ▱-marked drawn shapes, and `resolvePolygonExtent`
answers a non-drawn `layer:` id from the layer's own `bounds`, CONVERTING
`{minX..maxY}` to this module's `{west..north}` there rather than leaking two
bound vocabularies to callers — the exact trap `drape()` documents. Verified
live: two presses set "Fetch area set: 8.09–29.49°N… Listed in Vectors &
Shapes", and a ticked Natural Earth countries layer appears as an extent and
resolves to its own bounding box.
## Drawing: press-drag boxes, visible handles, one gesture grammar

**The Points tool** (`gis/point-tool.js`, Earth's page only) is the third
way data comes in: a rail button arms it, each CANVAS tap (window-level
capture gated on `event.target === renderer.domElement`, or every panel
click drops a point under the sidebar) picks the ground through the
viewer's own `surfaceLatLonAt`, live preview dots ride the spin through
`GeoIDProjectLatLon` (HTML overlay at z 5 — no THREE owned), and Done
files the set through `importFileList` as "Points N" (`frame: false` — the
points were just placed on screen), so symbology, extraction, the project
registry and the data-tag arrival card all just happen. Escape/Cancel
discards; an armed measure tool is stood down on arm and yields taps
either way. `pointsToGeoJSON` is pure and pinned (viewer 0–360 → signed).
The tool runs on the PLANETS too (boot.js MODULES): where
`surfaceLatLonAt` is absent it chains the world's own `pickOnGlobe` seam
in a loop — that pick resolves on pointerdown and swallows the event, so
orbiting while armed is not possible there (arm, click, Done), an epoch
counter guards the stale pick a mid-pick Done leaves armed, and disarm
synthesises Escape to settle it. Gas giants (no `setStudyAreaPolygon`)
never build the button. The Workspace + GEE button is Earth-gated in
add-data.js — gee.js never runs on the planet pages. Verified: Mars picks
two points into "Points 1" with Mars coordinates; Jupiter builds no
button. It REPLACED the Workspace "Custom" capture button, whose only unique
moment — shape drawn but not captured — the Draw HUD's Done already
answers, and whose empty press could only nag, stacking a note per press.

**Point letters are PROFILE furniture; the clocks can wear a zone.** The
A/B/C letters `addMeasureMarker` drew on every measure point now draw only
in profile mode — a profile is read against its chart whose axis runs
A→B, while a polygon's own annotation and the distance/route readouts
already say everything (verified: 4 dots 0 letters on a drawn box, 2 dots
2 letters on a profile). The letterless visuals push `labelSprite: null`
and the per-frame scaler now scales the dot before bailing on the label —
the old guard skipped the WHOLE visual. This is Earth-only code (outside
the porter's block; planets keep their own copies). And Settings ▸ Clock
timezone (`#gis-clock-tz`, stored as minutes in
`geoid-gis:utc-offset-min`) offsets BOTH clock displays — the
seven-segment corner clock and `#gmt-clock`, each naming the zone it
shows ("UTC+1") — while the model, the scrubber field and every fetch
date stay UTC on purpose: a request stamped in somebody's summer time is
the ambiguity zones exist to cause. The offset is read per tick, so a
Settings change shows within a quarter second, no reload.

With the Draw tool armed, PRESS on the globe and DRAG — a box grows live
under the pointer with its size in km beside the cursor; release and it
stands with eight visible handles (four corner squares that resize, four
edge dots that move). A TAP without movement still places a polygon
vertex — the decision is 5 px of movement, controls stand down at press
(in draw mode a drag draws), and a press-start stray vertex left by what
becomes a drag is erased by the first rect rebuild. Esc cancels any drag.

Three measured traps live in this apparatus:

- **Classify grabs by the PICTURE, not the ground.** The handles project
  the LIFTED surface point; the raycast hits the ground beneath — at
  oblique views they part by tens of pixels, so a grab classified by
  ground tolerance misses the very square it shows. `handleAt()` tests
  the pointer against the DOM dots; the drag itself still moves by ground
  hits.
- **Corners move by the drag's DELTA**, anchored to the corner's original
  position — the absolute ground hit sits a parallax-width inside the
  box, and min/max against it SHRINKS the span you meant to grow.
- **The vertex add is the canvas's own `pointerup`** (≤10 px gate against
  its recorded pointerdown) — a synthetic pointerup dispatched on
  `window` never reaches it, which reads as a broken tap and is a broken
  TEST. Target the canvas.

**The Draw HUD** (`gis/draw-hud.js`) is the gesture bar over the canvas
whenever a drawing tool is armed: Box / Circle / Polygon / Line, Done,
Cancel, and a hint line that always says the next step. The shape choice
travels as `window.GeoIDDrawShape` — box and circle drag-draw, "poly"
leaves drags to the orbit controls so taps place vertices. Circle is
press-centre-drag-radius (48-segment ring, live "⌀ N km" chip). Done =
`captureDrawn` → relief-hugging layer + overlay cleared (Enter works);
Cancel clears and puts the tool away. The HUD polls tool state at 250 ms
— rail clicks, shortcuts and modules all arm the tool, and polling beats
wiring into each. A persistent dimensions chip ("W × H km") rides the
rect's north-mid handle whenever a rect stands un-dragged. The side DRAW
card stays as the preset/precise path (regular polygons, exact km); the
HUD is the hands-first one — complementary, not duplicates.

Rect editing is wrap-safe (bounds renormalise on rebuild; corner/edge/
delta comparisons use wrapped lon distance) and hand-drawn polygons are
left alone — no corners a rectangle rule may move. The zoom pill's ends
are − and + now, not arrows.

### A drawn polygon is an OUTLINE, and its annotation survives the save

A saved shape came back as an opaque fill over the ground it was drawn
around — which is the opposite of what an extent is for. A geological unit
wants a fill because the fill IS the statement; a study area wants an edge.
`renderFeatureCollection` takes `outlineOnly`, which sends the rings to the
lifted depth-tested LINE buffer (with their colour) instead of to
`fillTriangles` and the coplanar `seal` — the seal has nothing to seal
against with no fill beneath it. `captureDrawn` passes it; ordinary imports
are unchanged.

**The mode rides with the LAYER, not with a paint call.** `repaint` is called
by every symbology path — the default paint on load, the dialog's Apply, a
catalogue palette — and none of them knows or should know whether this layer
is filled. `setFillMode`/`getFillMode` hold it on the layer and re-run the
LAST paint, so the fill mode and the palette are independent: verified that
applying an orange changed the colour and left the layer an outline.

The dialog gained two rows, both applying immediately (they are independent
of the palette, so there is nothing to hold back for): **Polygons**
(outline/solid, offered only where `setFillMode` exists — a layer with no
polygons would get a control that does nothing) and **Annotation** (on/off,
offered only for `ext === "drawn"`).

**Its Style row now opens on One colour.** A drawn shape is ONE feature, so
every column holds exactly one value and every one is disabled by the
two-distinct-values rule — "By attribute" opened a picker in which nothing
could be picked. `classable` is that test hoisted out of the option list.

**`gis/area-labels.js` keeps the writing on a saved shape**, following it as
the planet turns, scoped to `ext === "drawn"` on purpose: a geological map is
thousands of polygons and an area written in each is a wall of type over the
map it describes. It projects through **`window.GeoIDProjectLatLon`**, which
the viewer exposes from the same block that places the drag handles — a
module deriving its own screen position would be a second copy of an
arithmetic this file already records getting wrong. A plain global rather
than a viewer-seam property because the seam literal is built BEFORE that
block on the planet viewers and AFTER it on Earth; assigning into it would
work on five worlds and miss the sixth. That seam sits ABOVE the three
listener registrations, which are the porter's end anchor — put it below and
it never reaches the planets.

`vector-fill-mode.test.mjs` asserts on the GEOMETRY (a fill is a Mesh, an
outline is LineSegments) rather than on the option being accepted, because a
silently-ignored option draws exactly as before with no error anywhere.

### The Draw bar reaches every rocky world already, and arms UNDECIDED

**Nothing here needs porting by hand.** `draw-hud.js` is one shared module
loaded by `gis/boot.js` on the planets and by a script tag on Earth, so the
bar — icons, order, Custom, the export slot — is the same object everywhere.
The gesture behind it lives in the ported block, so `port-draw-tools.py`
carries it. Verified live rather than assumed: Mars and Mercury show the
identical eleven-item bar at 471 px and draw their own shapes on their own
constants (a hexagon reads 993 × 1134 km on Mars, where Earth's 111.32 would
have said about 2,100), and Jupiter builds no bar at all because it has no
`setStudyAreaPolygon`.

**A grep across `planet_explorer/*/viewer/*-viewer.js` can lie.** More than
one file matches that glob per folder, so `head -1` checked the wrong one and
reported four of the five worlds as missing a change the porter had in fact
made. Name the file (`$p-viewer.js`), which is what the porter's own table
does.

**The bar arms with NOTHING chosen.** It used to arrive on Rectangle — a
decision made for somebody before they had made it, and the first press drew
one. It resets to undecided every time the tool is picked up, not just the
first: coming back to whatever was drawn last is the same decision made twice.

Three states, and the third is the point: `GeoIDDrawShape` UNSET still means
"box", so a world that loads no Draw bar behaves exactly as it always did,
while "" is the bar saying it has not been told yet. `chosenDrawShape()` is
the one reading of that.

**Both gestures have to be held back, and the tap is the awkward one.** The
drag returns early from `drawPointerDown`; the tap is swallowed in
`drawPointerUp`, which is a WINDOW CAPTURE-phase listener and therefore runs
before the viewer's own bubble-phase vertex-add on the canvas — so a stray
click on an undecided bar cannot start a polygon. Doing it there rather than
in the click handler is also what carries it to the five rocky worlds, since
the porter copies that block and not the viewer's click handling.

### The preset card is gone — the shapes drag out on the Draw bar

It sized a triangle by typing a number into a field, which is a different
grammar from the one the rest of this tool uses, and it was where every fault
below lived. **The bar was reported as working perfectly, so the shapes moved
to the bar rather than the bar growing a card.**

Triangle, square, pentagon and hexagon are the CIRCLE'S OWN GESTURE with one
number changed — `DRAG_RING_SIDES` maps a shape id to a segment count, and the
ring branch that drew a 48-segment circle now draws any of them. A hexagon is
therefore drawn exactly as a circle is and there is no second path to keep
working. The square is turned 45° so a drag gives the axis-aligned box
everybody means by "square"; the odd-sided ones point north. Verified with
REAL mouse drags (`computer left_click_drag`): 3, 4, 5, 6 and 48 vertices.

They come in as GLYPHS and the original four keep their words: four more
words takes the bar from ~300 px to over 700 and off a narrow screen, and
"Triangle" says nothing a triangle does not.

**Export CSV is MOVED onto the bar, never copied** — the viewer holds a live
reference to `[data-measure-actions="area"]` and shows it as a measurement
comes and goes, so a copy is a dead twin. Borrow it on the TRANSITION, not on
every pass: `refresh` is polled and the viewer re-parents that node itself, so
borrowing each tick had the two passing it back and forth — measured, Done
sent it to the rail and standing the tool down sent it to the bar, the
opposite of both. The card did it on open/close and so does this.

**Synthetic pointer events do not exercise this drag.** A dispatched
pointerdown/move/up sequence left the shape untouched and read as a broken
feature through two rounds of debugging; the same gesture through
`computer left_click_drag` drew every shape first time. Where a drag is being
verified, drive the real mouse. (The clamp at ±85° is also real: a ring
dragged out near a pole collapses its vertices onto the limit, which looks
like a broken shape and is the clamp doing its job.)

### stopPropagation in a WINDOW CAPTURE listener also hides the event from OrbitControls

Picking up the Draw tool and pressing once left the globe following the bare
cursor with nothing held down — reported as "the globe navigation/spin
becomes fully coupled to the cursor movement".

`drawPointerUp` is registered `window.addEventListener("pointerup", …, true)`.
The undecided-shape branch called `event.stopPropagation()` to stop a stray
tap placing a polygon vertex — and in the CAPTURE phase on `window` that does
not merely hide the release from the viewer's own vertex-add. It hides it
from **OrbitControls**, which is mid-gesture because the press reached it
normally. Never told the button came up, it stays latched in `STATE.ROTATE`
and every later `pointermove` turns the planet. EVERY press-release while the
bar was undecided left it that way, so one stray click made the globe
unusable until the next press.

The fix is the mechanism that was already sitting ten lines below:
`suppressDrawClick`, whose capture-phase `click` swallower on the canvas the
drag path uses so one gesture is not also a vertex. **The CLICK is what adds
the vertex and it fires after the pointerup**, so suppressing the click stops
the vertex while OrbitControls still receives the release it needs to
unlatch. Inside the ported block, so `port-draw-tools.py` carried it to all
five rocky worlds.

**The A/B is the whole verification, and it needs a REAL mouse.** Synthetic
pointer events do not exercise OrbitControls here (this file's own warning),
so the check re-injected the fault live — a window capture-phase `pointerup`
calling `stopPropagation` while `GeoIDDrawShape === ""` — and drove real
clicks and hovers through `computer`. Measured, with the spin PAUSED so any
motion is the cursor's doing: **10.545 units of camera drift with the fault
injected, 0.000 with it removed on the identical gesture**, the tap still
placing no vertex and creating no layer, and a real drag with Square chosen
still drawing a 4-vertex shape with 0 camera drift. A clean number means
nothing here without the control that reproduces the fault.

### A preset shape is a DRAFT, and it has to re-sample as you fly in

"The header draw pill works perfectly, the issues lie in the preset shapes"
is the most useful bug report in this file: two paths make the same geometry
and only one looked right, so the difference is never in the maths. Four
faults, all in the preset path:

- **Placing COMMITTED.** `place()` called `captureDrawn()` the moment a
  preset was pressed, so choosing "square" stamped a permanent Study area N
  before you had said what size you wanted — and the capture is idempotent
  by SHAPE, so a resized box is a different shape and stamped ANOTHER.
  Measured: three presses left three layers on one patch of ground, one size
  change took 2 to 3, and at close zoom those stacked rings at different
  sizes are what "deformed" looked like. The standing overlay is the draft
  now, exactly as a drag-drawn box is; the HUD's Done is the one thing that
  saves it. One gesture grammar for both ways of making a shape.
- **A preset had no handles.** `rectFromMeasurePoints` needed EIGHT points;
  a drag-drawn box arrives subdivided and clears it, a preset square is its
  four corners. The floor is four now, with a sparse shape having to be a
  rectangle EXACTLY — every point at both extremes, i.e. a corner — because
  a triangle's three vertices all touch their own bounding box and rectangle
  handles would let a drag turn it into something it is not. This gate is
  INSIDE the ported block, so `port-draw-tools.py` re-runs with it.
- **The size field fired on `change` only**, so typing 25 left the 10 km box
  on screen until you clicked elsewhere and the field read as inert. It
  re-places on `input`, debounced, skipping half-typed values.
- **No preset took an XY extent.** Every one was regular, so a single side
  said everything about it, and a study area rarely is. The Rectangle uses
  `rectangleVertices`, which draw-area.js had exported and nothing used.

**And the lift is baked at build time, which is why a preset floated.**
`getMeasureDisplayLift` is a fraction of the distance to the surface — right,
and `activateStudyArea` samples each vertex ONCE. Measured on a 40 km square
placed at 3,006 km and then viewed from 20 km: the ring sat at radius 3.23591
where the ground is 3.2006, **about seventy kilometres above the terrain**,
and obliquely that reads as a deformed shape rather than a floating one. A
drag never showed it because a drag rebuilds on every pointermove at the
distance you are drawing from. `refreshMeasureForViewDistance` makes the
render loop rebuild when the viewing distance changes by a third either way,
never mid-drag — the same call the terrain slider already made for the other
input that moves the ground. Verified: the shape comes down 70.2 km by
itself. **Earth only**: the planet viewers re-project every measure point
with the CURRENT lift (`projectMeasurePoint`'s default) instead of baking
one, so they never had it.

### The area fill's APEX was round-tripped through lat/lon, and landed on the far side

A three-point polygon on Mercury drew a correct triangle with a long spike
trailing out of it — "the trailing kink outside of the 3 defined points". The
vertex list was innocent: three points, no wrap, no stray, because the OUTLINE
is built from boundary points that are never converted. The FILL is not. It is
a triangle FAN — one triangle per edge, all sharing an apex — and that apex was
derived by `vectorToLatLon` on the centroid direction and then
`sampleMeasureSurfacePoint` to turn the lat/lon back into a position.

**Those two do not agree about which way longitude runs on a west-positive
world.** Measured on Mercury: apex `(2.833, -0.199, -1.476)` against a true
centroid of `(-2.833, -0.199, -1.475)`. X negated exactly — the apex lands on
the OPPOSITE SIDE OF THE PLANET, 5.67 units away on a globe of radius 3.2,
while the shape itself spans 0.137. All 121 triangles ran to it, and that is
the kink.

The fix is to never leave the frame: the centroid direction and the boundary
are already in one, so the apex goes along that direction at the MEAN BOUNDARY
RADIUS. No lat/lon, no convention to disagree about, and it sits on the same
terrain the boundary was sampled from. The `kind === "moon"` branch a few lines
above already refuses the round trip for exactly this reason and says so — the
same lesson, learned once and not carried across to the planet branch.

Measured after: Mercury apex-to-centroid **5.6668 → 0.0000**, and Mars (which
never showed the fault, being east-positive) also 0.0000 with the apex radius
equal to the boundary mean to four decimals — the fix costs the working worlds
nothing. Applied to all six viewers that can draw; the four gas giants have no
such code because they have no surface to draw on.

**The diagnostic that found it**: read the fill mesh's own positions, take the
first vertex of every triangle as the apex, and compare it with the centroid
recomputed from the other two. An apex further from the centroid than the
shape is wide is the spike, stated as a number. The vertex list looked
perfect throughout — the geometry the USER sees and the geometry the app
RECORDS are two different things, and only one of them was wrong.

### The handles were drawn in the WRONG FRAME

`measureGroup` carries the globe's spin — `rotation.y = _spinDelta`, set every
frame — and the drawn outline is its child. `studyRectScreenPoint` projected
through `marsGroup`, the parent, which does not. So the handles were drawn in
the BASELINE frame and the shape in the spun one, and the two parted by
exactly however far the planet had turned since the page opened.

Measured on Mars against the viewer's own cursor readout, hovering each
handle: every corner off by the same **~10° of longitude — 592 km** — with
latitude exact to a fraction of a degree. *Latitude exact and longitude
uniformly wrong is the signature of a rotation about the pole*, which is what
separates this from a coordinate-convention error; look for that before
suspecting the CRS. Reported as "the click and drag to resize points have a
massive offset from the actual bounds of the shape", and it was.

`measureFrameGroup(context)` returns the frame the geometry actually went
into — `moonMeasureGroup` for a moon, `measureGroup` otherwise. The variable
is called `measureGroup` in all six viewers and is parented to each body's own
group, so this needs **no per-body rewrite**; the porter's group substitution
now only touches comment prose. `draw-port.test.mjs` pins both halves: it must
project through `measureFrameGroup`, and it must NOT project through the body
group above it. After the fix, with the planet still spinning, every corner is
within 0.8° on Mars and 0.25° on Earth — the documented sub-degree marker
parallax, not a frame error.

### The area is written ON the polygon, not in the corner

A number describing a shape belongs on the shape. The area used to arrive as
a card pinned to the corner of the window and the dimensions as a "W x H km"
chip clipped to the rect's top edge — so the one thing not near the polygon
was the number about it, and with two boxes drawn neither box said which card
was its own. `updateAreaLabel` replaces both with one ANNOTATION at the shape's
centre: its name, the area as the headline, and beneath that the BOUNDING
width x height — for free shapes as well as rectangles. Perimeter ("N km
around") was tried on free shapes and reported as noise: a fetch extent's
size is width by height, whatever the outline's wiggle. The saved-shape
annotation (area-labels.js) carries the same "W × H km" line, computed
with km-per-degree off the BODY's own radius, because that module runs on
the planets and 111.32 is Earth's number and nobody else's (the live
label's literal is per-body via the porter rewrite instead).

**An annotation, not a card.** A fill and a border sit on top of the polygon
and hide the ground it was drawn to look at, which is the whole reason for
putting the number inside the shape at all. So there is no background and no
border — the text is written on the map the way a place name is, staying
legible by carrying its own dark halo (three shadows: one soft glow vanishes
against bright imagery, one hard outline looks stamped-on over dark).

**The name is the one the shape will KEEP.** `nextDrawnName()` is exported
from drawn-layers.js and used by BOTH the annotation and `drawnFeature`, so
what is labelled while drawing is what the layer row says after Done. The
prefix is "Study area N" rather than the old "Drawn area N" because that is
the app's own word for this thing — the panel, `setStudyAreaPolygon` and
`activateStudyArea` all say so — and a label predicting a different name from
the one the layer takes is the two-names-for-one-thing fault `renameLayer`
documents at length.

Nothing is lost by dropping the card. What it also held — elevation range,
mean slope, geology, the histogram — is in the Study Area panel, which
carries strictly more of it. The split is the point: the label says what the
shape IS, the panel says what is UNDER it. Distance and Route keep their
cards, because a line has no inside to write in.

**The centroid is the wrong centre for placement.** `polygonCentroidLatLon`
is right for arithmetic and wrong for a label: the globe curves away, so the
projected midpoint of a large box sits ABOVE the middle of the outline you
can see. Measured on a 225 x 144 px box: horizontally exact, vertically
**20 px high** — a seventh of the shape, and it read as sitting on the top
edge. Placement samples the shape's own SCREEN box instead (a dozen vertices
is plenty, and it runs every frame), which measured 0 px offset in both axes;
the centroid survives only as the fallback for when the projection cannot
answer.

**Inside when it fits, above when it does not.** Measured: a box dragged out
14 x 10 px on screen was given a 94 x 38 px label — text swamping its own
shape and covering the corner handles you would reach for next. The label
steps above the top edge when the shape cannot hold it, which is what a map
does; "always above" would be worse, because a label inside its polygon needs
no leader line to say what it belongs to. Hidden entirely while a drag is
live — the chip at the cursor is already reporting the size, and two numbers
moving together is noise.

Being inside the ported block, one edit reached all six worlds. Verified on
Mars: centred to 3 px, and 2,333 km where Earth's constant would have said
4,389.

### The drawing tools are on the rocky worlds too, by GENERATOR

The press-drag box, the eight handles, the size chips, the hover cursors
and the Escape cancel now run on Mars, the Moon, Mercury, Venus and Pluto.
There is no module they could share — every planet viewer is a
self-contained copy, and `stamp.py` deliberately does not sweep
`planet_explorer/**/*.js` — so the choice was five hand-maintained copies
or one generator. **`services/port-draw-tools.py` is the generator**: it
lifts the block out of earth-viewer.js between two fixed anchors, rewrites
the three things that are per-body, and writes it between markers so
re-running REPLACES rather than duplicates. `--check` exits non-zero when a
copy is stale. **Edit Earth's copy and re-run it; never edit a generated
block** — that is the lesson the polygon-area formula cost, the same
arithmetic written out in ten places and corrected in one.

The three per-body rewrites, each a real bug if skipped:

- **Kilometres.** 111.32 is Earth's and nobody else's, so it comes off each
  viewer's own mean-radius constant. Measured on Mars: the same box reads
  697 x 1410 km with Mars's radius and would have claimed 1312 x 2654 with
  Earth's — the exact shape of the `MARS_MEAN_RADIUS_KM = 58232` fault, and
  invisible without a number to check it against.
- **The scene group.** The handles project through it; Mercury, Venus and
  Pluto each have their own, and the wrong one puts every handle off the
  canvas. Verified on Mercury: 8 of 8 handles inside the canvas box.
- **`lonDelta`.** These files already have a `const lonDelta`, and a
  hoisted function declaration beside it is a SyntaxError — one that would
  have bitten only the worlds whose file happens to have both.

**A gas giant gets no HUD, and the test is the SEAM not the button.** All
four carry `tool-rail-area` in their markup but have no
`activateStudyArea` behind it, so keying the HUD on the button put Box,
Circle, Polygon and Done on Jupiter with all four inert — "wire it or
leave it disabled". `draw-hud.js` gates on
`window.GeoIDViewer.setStudyAreaPolygon` instead, with a bounded retry
(the viewer boots async, so a missing seam early is usually just early;
120 tries then stop, rather than polling Jupiter for the life of the
page). Verified: Jupiter builds no HUD and keeps its zoom.

Two seams the port had to add to all five: `clearStudyArea` (the HUD's
Done and Cancel call it) and the `geoid-study-area-edited` dispatch inside
`setStudyAreaPolygon`, which is what `gis/pipeline-sync.js` listens for —
without it the planets drew shapes the project never heard about.

`draw-port.test.mjs` asserts each generated block is byte-for-byte what
the porter would write today, that no Earth kilometres survive in any of
them, and that the four gas giants are untouched.

**The pipeline follows the pen: drawing syncs GIS, Model and Research live**

Three seams keep what the user draws and what the pipeline knows in step,
with no button between them:

- **`setStudyAreaPolygon` announces** (`geoid-study-area-edited`) — every
  creator flows through it (presets, the weather box, restored areas) and
  drag edits already announced, so one dispatch covers all of them.
  `gis/pipeline-sync.js` listens and, 900 ms after the shape settles,
  writes the OPEN project's `study_area` bounds and
  `metadata/study_area.geojson` via the bridge's own captureStudyArea.
  Silent when no project is open (the ordinary state) and when the bridge
  refuses an antimeridian-crossing area.
- **`captureDrawn` registers the shape as a DATASET**: alongside the
  processed artefact it now calls `registerImportedLayer` with a File
  built from the GeoJSON, so the drawn shape lands in the project's data
  registry with a `data/raw/` copy — the same standing as any import.
- **"To Model" in the layer drawer** for drawn polygon layers hands the
  ring's bounds to the Meshing Studio through the same `sendToStudio` the
  Research Hub's button uses.

Drawn layers were ALREADY live inputs to clipping, zonal statistics and
extraction (they are ordinary vector layers; the tool selects list them
on layers-changed) — measured, not assumed. The layer drawer's tile is
`.layer-options` opened from the ROW; a probe that greps page-wide
buttons reads the catalogue's Symbology and misses the drawer entirely.
## The tool registry was swept from the DIALOG, and that is the test that counts

All 47 tools run through `openTool`, the real controls and the real Run
button, against fixtures with closed-form answers (a collinear polygon pair,
attributed points, a line, a gaussian-hill DEM imported as `.asc` — the ASCII
grid is the cheap way to a genuine raster fixture). Six faults, none of which
a seam test had shown, all fixed:

- **The boolean degeneracy is now guarded in ALL THREE ops.** Collinear
  overlapping edges defeat `segmentIntersection` (zero denominator), leaving
  an odd crossing count; the traversal then returns the subject whole OR
  shreds into near-zero fragments. `unionRings` accepts exactly two shapes of
  answer (one ring covering both, or the inputs back with area intact);
  `intersectRings` bounds-checks every piece against the overlap box;
  `subtractRings` audits by TILING against the checked intersection. All
  retry against a ~0.1 mm nudged mask and fall back honestly. Clip +
  difference of any subject must tile it — that invariant is pinned.
- **`{ value, label }` options passed the dialog and failed the validator**
  (`o.id === value` only): mosaic refused every choice INCLUDING ITS DEFAULT
  from the day it shipped. A registry with two option spellings needs every
  consumer to read both.
- **A field param can be `optional: true`** — blank reaches the engine as
  "whole layer". Dissolve (merge-everything had no door) and rocAuc/confusion
  (whose labels promised blank worked while validation refused it) carry it;
  the dialog offers a "— whole layer —" row.
- **`of:` on a field param is not decoration**: without it the field list is
  built from the FIRST input, and for raster-first tools that is a layer with
  no fields — an empty select and a refusal for a value that could never be
  chosen.
- **An error message must name the actual fault**: reclassify's comma-only
  split kept "a; b" whole and taught `min..max:class` when the SYNTAX was
  right and the separator was the problem. Separators are commas, semicolons
  or whitespace now.
- **The dialog's output-name resolver got only the FIRST input**, so
  templates naming a second (`dist_{features}`) reached the Workspace with
  braces in the layer name.

The sweep also proved the answers, not just the runs: clip 2225.5 vs 2225
km², difference 1731 vs 1731, blank dissolve 3832.9 vs 3833, ROC AUC 0.5 on
deliberately uncorrelated observations — which is the CORRECT answer, and a
tidy reminder that a validation tool agreeing with chance is sometimes the
data, not a bug.
## The whole chain, run end to end through the UI

Draw a polygon, take the DEM inside it, take the geology inside it, extract
the data within. Run on Northern Ireland through the real controls — the Draw
bar with a real mouse drag, the tools window, the extraction panel — and every
number below is what the page reported.

| step | how | result |
| --- | --- | --- |
| geology on the globe | Geology tab tick | World geology (Macrostrat) |
| draw the polygon | Draw bar, Rectangle, real drag, Done | Study area 1, **610.158 km²** |
| DEM within | tools window → Terrain to raster | **121x111 at 215 m**, −39 to 265 m |
| geology within | tools window → Clip | **52 polygons, 17 units** |
| data within | Extract From Layers, 0.5 km | **2,496 samples, 34 columns** |
| native tables | automatic | dem at its own **213 m** cells, 13,431 |
| elevation per unit | Zonal statistics | 52 zones, painted by `zonal_mean` |

Checks that make the run mean something rather than merely complete:

- **The area is right by hand**: 0.4015° of longitude at 54.73° is 25.8 km,
  0.2129° of latitude is 23.7 km, so 612 km² against the 610.158 reported.
- **The clip fetched the right ground first**: the geology layer held 7,534
  features (the view it last rebuilt for) and 966 after being asked about the
  polygon — the `featuresIn` path, working through the dialog.
- **The geology is real and local**: Tyrone Group, Armagh Group, Sherwood
  Sandstone Group, Mercia Mudstone Group, Ulster White Limestone, Palaeogene
  extrusives, Argyll Group, Moine Supergroup.
- **The column agrees with the clip**: `geoid_geology` filled for 2,465 of
  2,496 samples (98.8%), 16 distinct units against the clip's 17 — one unit
  is too small to catch a 0.5 km sample, which is the honest difference.
- **The answer is geologically coherent.** Elevation by unit: Lough Neagh
  Clays −34.5 m (the lough itself, and the lowest thing in the box),
  Palaeogene extrusives 13.1 m at its margin, Sherwood Sandstone 48.7,
  Armagh Group 53.8, Tyrone Group 112.3, Roe Valley 128.1, Moine Supergroup
  131.8, Argyll Group 142.8, Ordovician extrusives 196.4 m — basin low,
  uplands high, in the order the map says.
- **The exporter writes four files**: the joined grid (2,496 x 34), the DEM's
  native table (13,431 x 3), and one per clipped vector layer.

**One honest caveat about the numbers, not the chain**: the elevations under
Lough Neagh are NEGATIVE (−39 m) where the lough surface is about 15 m above
sea level. That is the global DEM's own treatment of inland water, not
something the extraction did — the same class of limit as the 9,575 m native
sampling the terrain tool reports beside its 215 m grid. The chain reports
what the source says; the source is coarse and wet-blind here.
## An extraction asks about GROUND, never about the screen

Reported as drawing a square polygon and getting no geology data at all out
of the geology source map. It reproduced first try, with everything as
shipped: *"Within the drawn area — 7,567 samples over 7,511 km² · 1 vector
layer: 0 of 0 features within"* — with the geological map plainly drawn on
the globe, and the panel's OWN tick list beside it reading "9,137 features".
Both numbers were true and the answer was still nothing.

**Four faults, and each one hid the next.**

- **The geology COLUMN was off by default.** It shipped unchecked, labelled
  "GeoID geology class (slower)", so the main table — the file anyone
  actually opens — had no geology column at all whatever was on the globe.
- **`features()` answers "what is on screen".** That is right for a click
  card and catastrophic for an extraction: `collection` is a SNAPSHOT of
  whatever the camera was showing when the layer last rebuilt itself, and the
  tiled geology rewrites itself on every settle. The tick list counted the
  screen; the clip read the same screen a moment later, after a rebuild had
  emptied `visible`. `featuresIn(bounds)` asks the tiler about GROUND
  instead — it chooses the zoom the box deserves, fetches what is missing
  (cached, so a second extraction over the same area is free) and returns
  those features **without touching `visible`, `generation` or the scene**,
  so extracting never changes the picture. A layer that can do this says so
  by carrying `featuresIn`, and the panel asks every such layer about the
  study area before anything is clipped.
- **`Math.round(null)` is ZERO.** Passing "no particular zoom" to
  `chooseZoom` asked for the single world tile — 5,792 units for the whole
  planet, generalised so hard this file already records point-in-polygon
  finding nothing under Northern Ireland. Measured: 3 features clipped, all
  of them things like "Precambrian-Phanerozoic crystalline metamorphic
  rocks". The same shape as NaN-compares-false: a missing value that means
  the worst possible answer instead of erroring. `zoomForBounds` lives in
  mvt.js with the rest of the tiling arithmetic and is pinned there.
- **The geology column asked the VIEWER**, whose `getGeologyFeatureAtLatLon`
  answers from the map it currently has DRAWN. With the camera over Indonesia
  and the study area over Northern Ireland it returned nothing for all 7,567
  samples while the clip beside it returned real units. It reads the features
  covering the polygon now — the same ones the clip uses — so the column and
  the clipped layer are ONE SOURCE OF TRUTH and cannot disagree.

Verified under the hardest case available: geology loaded over Northern
Ireland, camera then flown to Indonesia (7,807 features on screen, all of
them the wrong ground), study area drawn over Northern Ireland, extraction
run with nothing touched. **966 features fetched for the box, 358 clipped
within the polygon, and the geology column filled for 7,477 of 7,567
samples — 98.8% — with Tyrone Group, Armagh Group, Leitrim Group, Gala
Group.** The 1.2% empty are samples over sea, which is the honest answer.

**The general rule this leaves:** a self-rebuilding layer's `collection` is a
snapshot with a timestamp nobody can see. Any consumer that asks a question
about a PLACE — extraction, clipping, sampling, zonal statistics — must ask
the layer about that place, not read whatever the layer last happened to
hold.

**The TOOLS had the same fault one layer down, and the fix cannot live in an
engine.** `runTool` calls `engines.native(...)` WITHOUT awaiting, so an
engine is synchronous and can fetch nothing. The refresh goes at the top of
`runToolAuto` — before the sidecar decision, before any engine, and on the
path the tools window already takes. Every input carrying `featuresIn` is
asked about the ground THIS RUN is about, and that ground is the extent of
the OTHER inputs: clipping geology by a drawn box is about the box, zonal
statistics of a raster over geological zones is about the raster. A
self-rebuilding layer's own bounds are the world and say nothing, so they are
excluded from that calculation; where every input rebuilds itself there is no
extent and nothing is fetched, which leaves the tool where it was rather than
guessing.

That extent falls back to the coordinates a layer actually HOLDS where it
carries no `bounds` — a derived or hand-built vector layer need not have
them, and failing through on that silently skips the fetch and leaves the
tool on the stale snapshot, which is the exact fault being closed. Found
because a fixture had no bounds and `clip` alone failed while
`zonalStatistics` passed.

And the SYNCHRONOUS path now refuses a self-rebuilding layer holding nothing
rather than running: an empty snapshot means "the camera is elsewhere", not
"this ground has no geology", and of the three available outcomes the
confident empty one is the worst.

Verified live with the camera over Indonesia and the study area over Northern
Ireland: the geology layer held **2** features at the moment the tool was
pressed, the tool fetched **966** for the box, clip kept **358** (Southern
Highland Group, Tyrone Group, Argyll Group, Leitrim Group, Roe Valley Group,
Gala Group) and zonal statistics of a DEM over those units returned **358
zones** — Southern Highland Group 192 cells at a mean of 103.7 m, Tyrone
Group 94 cells at 37.4 m. That is the whole workflow: map, draw, clip,
summarise per unit.
## Which maps the tools can actually see — audited by asking the seams

"Are all pre-loaded maps and those imported via GEE available for the GIS
tools, extraction and the Model Builder?" Measured with a user import, a
Natural Earth catalogue vector, a CHIRPS rainfall drape and a GEBCO overlay
all on the globe at once — asking `layersByType`, the extraction panel's own
filter and the Model Builder's list what each one returns:

| layer | `collection` | `raster` | `sampler` | tools | extraction | model |
| --- | --- | --- | --- | --- | --- | --- |
| user vector import | yes | no | yes | vector | yes | yes |
| catalogue vector (coastlines) | yes | no | no | vector | clip | yes |
| user GeoTIFF / `.asc` | no | **yes** | — | **all 30 raster** | yes | yes |
| Earth Engine drape (CHIRPS) | no | **no** | yes | **NONE** | yes | yes |
| shipped overlay (GEBCO relief) | no | no | no | **NONE** | **NONE** | listed only |

**`layersByType("raster")` returned an EMPTY LIST** with a rainfall map and a
bathymetry overlay drawn on the globe. An Earth Engine layer carries a
`sampler` — `gee-sample` recovers real numbers from the palette it was
painted with, which is why extraction has always read it — but it carries no
GRID, and the thirty raster tools admit a layer only if `layer.raster`
exists. Slope on a GEE elevation map, reclassify on rainfall, zonal
statistics over NDVI: none of them could see the layer they exist for.

**`sampleLayer` is the bridge, and it is `terrain` over a different reader.**
The area says where, the layer says what, and the answer is an ordinary
raster that chains into everything. `sampled` is a third input KIND that both
`matchesType` and `layersByType` understand, so the dialog fills that select
for free (it populates straight from `layersByType(input.type)`) and a drape
can never pass as a grid. Verified live on a real CHIRPS layer over the Congo
basin: raster layers 0 → a 121x121 grid at 14.8 km cells, 14,549 of 14,641
cells carrying a value, 8.2–300 mm — CHIRPS's own range — and reclassify,
zonal statistics and slope all running off it.

**A colour-only drape is refused BY NAME.** `makeSampler` returns a number
where the palette is invertible, `null` off-ramp, and an `{r,g,b}` where
there is no legend at all; rasterising that third case would be inventing
numbers. The shipped GEBCO and hillshade overlays are in exactly that
position — pictures with no legend — so they stay pictures, and that is a
statement about those files rather than a gap in the tools.

The general shape, worth keeping: **a layer's capabilities here are three
independent booleans** — `collection`, `raster`, `sampler` — and every panel
filters on one of them. When something "is not available", ask which of the
three it is missing before looking at the panel.
## Every tool, individually, IN THE SUITE — and what that found

The browser sweeps each found faults the one before had passed, and a sweep
somebody re-drives by hand stops being run. `tool-runner.test.mjs` is that
sweep in the suite: all 48 tools through the REAL runner, asserting on
VALUES against fixtures with closed-form answers (a plane has zero
curvature; the mean of a symmetric window on a ramp is the centre;
interpolating a constant field returns that constant; a perfectly separating
raster scores AUC 1 and the same raster upside down scores 0; clip and
difference must TILE the subject).

**The runner needs only a `window`.** `resolveLayer` takes a layer RECORD as
readily as an id, and `addDerivedLayer` is the one seam `register` writes
through — stubbed in the shape import-manager really returns, so an output
chains into the next tool exactly as it does on the page. A canvas stub
covers `buildRasterLayer`'s preview; nothing reads the picture, because the
`raster` the engine produced rides on the layer record beside it.

**Two STRUCTURAL checks, in both directions, and they are the last two bugs
generalised.** Every `p.<name>` an engine reads must be a declared param
(watershed read `p.lat`/`p.lon` while declaring none); every declared param
must be read by its own tool (viewshed collected `height` and read
`p.observerHeight`). The scanner strips COMMENTS first — viewshed's own note
about the bug contains the string `p.observerHeight`, and prose is not a
read. Five faults on the first run, none of them visible to any browser
sweep:

- **`difference` returned the subject WHOLE**, silently, whenever the mask
  shared the subject's y-range — the commonest overlap there is, and the one
  this file already documents and defends against inside `unionRings`,
  `intersectRings` and `subtractRings`. **The defence was never reached.**
  `ringEdgesIntersect`, the gate deciding whether the audited subtraction
  runs at all, counted only a strictly-interior, non-parallel crossing — and
  two rectangles sharing a y-range meet ONLY at vertices, so `punchHoles`
  concluded "disjoint" and handed back the untouched subject. Measured: A
  minus B returned 123.643 km² of a 123.643 km² subject while clip on the
  SAME pair correctly returned 24.729. The gate had been written on the same
  primitive the defence exists to work around. It falls back to sampling
  now — a boundary with points strictly inside the other ring and points
  strictly outside CROSSES it, whatever its edges do at the vertices — which
  also keeps the hole and disjoint branches right by construction (a
  contained ring has no outside point, a disjoint one no inside point).
  Sampled at three points per edge, never at the vertices, where a
  point-in-ring test on a shared boundary is a coin toss; and only after a
  bounds check, so a map of thousands of polygons pays nothing. Verified
  live: clip 17.178 + difference 68.712 = 85.890 = the subject, exactly.
- **A boundary-touching mask used to land on the right ANSWER by accident.**
  `geoprocessing.test.mjs`'s "difference removes both masks" got exactly 4
  because the masks read as disjoint and a first-vertex coin toss filed each
  as a HOLE — a hole touching the outer boundary, a degenerate polygon with
  the right area. It goes through the audited subtraction now and comes out
  as one comb-shaped ring whose notches are joined by 1e-9-tall slivers,
  which is what the nudge strategy has always produced. So the area check
  carries the nudge's own tolerance, and what the test asserts is WHERE THE
  GROUND WENT — masked ground gone, unmasked ground kept.
- **Kriging's two controls were BOTH dead.** The engine read
  `p.cellSizeDeg`, which no param declares, so the grid was always 0.01°
  whatever "Cells across" said; and the model select never reached
  `krigeGrid`, which called `sphericalModel` unconditionally and then
  REPORTED "spherical variogram" however Exponential was set. The sidecar
  honoured both, so one form gave two different answers depending on which
  engine ran. `exponentialModel` exists now and the family is FITTED as well
  as applied — a range fitted under one family and used under another is a
  third model nobody chose — and `krigeGrid`'s message, which carries the
  fitted nugget/sill/range and is the only way to judge whether the surface
  is worth believing, reaches the user instead of being computed and
  dropped.
- **Kriging was then UNFINISHABLE, which is what honouring its own default
  exposed.** The kriging matrix depends only on the samples and the
  variogram, never on the cell being estimated, and it was rebuilt and fully
  eliminated for EVERY CELL — 65,536 of them at the default 256 across. LU
  once, substitution per cell: same arithmetic, same answer, O(n³) once plus
  O(n²) a cell. A performance fault that reads as a hang is still a fault.
- **A zero-variance field came back as an EMPTY raster reported as
  success** — every semivariance zero, the system singular, every weight
  null. The kriging estimate of a constant field is that constant, so it is
  answered directly; and a grid where nothing was estimated is a refusal
  now, not a blank map that looks like an answer. Same family as watershed.
- **`rasterize` required an attribute**, so a fault trace or a road network —
  a line layer with no numeric column at all — could not be rasterized.
  Blank means PRESENCE. Verified live: 104 cells from a line, no column.

**A raster layer starts a 250 ms relief poll, and that is why any headless
run hung.** `registerDrape`'s watcher is right on a page and kept the test
process alive forever with all its work done and printed — 200 s against
0.44 s. `watcher?.unref?.()` is a no-op in a browser (a browser timer is a
number) and the whole point outside one: a poll that redraws drapes must
never be the reason a process cannot exit. **When a headless run of page
code "hangs" after printing its results, look for a poll, not a deadlock.**
## The full-development sweep: check OUTPUTS, not ok flags

Every tool run through the real runner with pure DEFAULTS (auto-resolved
inputs, untouched params) and its OUTPUT inspected — band stats for rasters,
feature counts for vectors, row shapes for tables — then all 48 dialogs
opened and their input/field selects checked for real options. Final state:
**48/48 run with defaults and produce non-empty outputs; 48/48 forms open
with every select populated.** Six real faults on the way, each invisible to
an ok-flag sweep:

- **`watershed` had shipped EMPTY since day one.** Its engine read `p.lat`
  and `p.lon` while the tool declared NO params, so every run walked in with
  `(NaN, NaN)`: NaN compares false against every bound, the range check
  passed vacuously, `out[NaN] = 1` seeded nothing, and an empty basin
  returned as `ok: true`. Outlet params exist now; the untouched default
  means "the main river's exit" (fill once, flow accumulation, argmax cell,
  stated in the message with the catchment area), and `hydrology.watershed`
  refuses a non-finite outlet outright (pinned). Every earlier sweep counted
  this tool as passing.
- **`viewshed` ignored the observer height it collected** — the engine read
  `p.observerHeight`/`p.radiusKm` against params named `height` and nothing:
  a form field an engine never reads is the quietest dead control. And the
  observer defaulted to (0, 0), the Gulf of Guinea, so the untouched form
  always answered "outside the DEM". The default now means the DEM centre
  and says so; a typed point off the DEM keeps the honest error.
- **`reclassify`'s default rules were the NI slope classes** — a worked
  example that silently assumed the input was slope in degrees; on the
  obvious first raster (a DEM in metres) not one cell matched. Blank rules
  now mean "cut into N quantile classes" (zero typing on ANY raster;
  quantile because most rasters here are skewed — the FRP lesson), and a
  rules miss names the raster's actual range. Two follow-up faults in the
  fix itself, both caught live and neither by the unit suite: the quantile
  rules were `{min,max,value}` objects where `RA.reclassify` destructures
  `[min, max, class]` ARRAYS, and the success note still read the variable
  the edit had renamed.
- **`rasterize` was polygon-only**, so an OCCURRENCE layer of points — the
  commonest rasterize in a susceptibility workflow — produced an empty grid
  behind an error about polygon overlap. Points stamp their containing cell,
  lines are walked at half-cell steps (pinned: a diagonal stamps every
  column it crosses).
- **`rocAuc` refused presence-only observations** ("ROC needs both
  outcomes") — exactly what a landslide inventory is. Seeded random
  background cells now stand in as pseudo-absences (the South Wales
  validation's own method), and the message says the negatives are
  background, not observed. Measured on deliberately uncorrelated fixtures:
  AUC 0.47, which is the CORRECT answer.
- **`zonalStatistics` answers as the ZONES now, not a discarded table** —
  the polygons with `zonal_cells/min/max/mean/sum/std` written back as
  attributes, painted by `zonal_mean` on arrival through the same `paint`
  seam the multi-ring buffer uses. The join back to features is by IDENTITY
  of the properties object the engine already carries — results skip
  zone-less features, so index pairing would hand zone 3's numbers to
  zone 2. Verified: two symmetric zones, 2,014 cells each, west mean 2,812 m
  against east 2,044 m over ground that really does fall eastward.

**Harness traps, paid for again in one session:** importing `tool-dialog.js`
under a fresh `?v=` makes a SECOND instance whose backdrop poisons the
page's own (every later open "fails"); read the stamp off a live script tag
and import THAT. And close a dialog through its own button — forcing
`hidden = true` desyncs the module's internal state so nothing reopens.
## "Not easily used" measured out as: 30 tools waiting on a raster nobody had

Asking what each tool DEMANDS was more revealing than asking what it produces.
**30 of the 47 need a raster** — 17 raster-only, 8 raster+vector, 5
raster+raster — and `layersByType("raster")` admits a layer only if it carries
`layer.raster`, which arrived by exactly ONE route: the user importing a
GeoTIFF or `.asc` themselves.

So on a fresh page, and on every planet, Slope / Hillshade / Contours /
Watershed — the obvious first things anyone opens — could not run at all. The
palette was two thirds inert, and that is what "too many of these are not
easily used" is: not obscure parameters, a missing input.

Meanwhile every world already HAS elevation. It displaces the globe, the
cursor readout quotes it, the extraction panel samples it, and (since the seam
work) `surfacePoint`/`elevationNormalized` publish it. It was simply never
offered as a LAYER.

**`terrain` — "Terrain to raster (DEM)"** takes any polygon layer and samples
this world's elevation into a DEM, so the first tool a reader opens produces
the input the other thirty were waiting for. It reuses the Model Builder's
`buildSurface` rather than rewriting it — the body-radius conversion, the node
cap that holds, and the fill-and-count for nodes the DEM cannot answer all
come with it. Two details that are bugs if reversed:

- **The band is FLIPPED on the way out.** `buildSurface` indexes
  south-to-north; a raster row runs top-down. Unflipped, every terrain map
  derived from it is upside down while looking perfectly plausible.
- **The engine must be SYNCHRONOUS.** `runTool` calls
  `desc.engines.native(...)` **without awaiting it**, so an `async` engine
  hands `register()` a Promise and the raster comes out `undefined` — measured
  as "Cannot read properties of undefined (reading 'length')". `model-build.js`
  is pure and DOM-free, so it is imported STATICALLY: the module stays
  Node-clean and the engine stays sync.

Verified end to end in the browser from a drawn box: a 40 km study area over
the Valais Alps produced a 121x121 DEM spanning **1,088-3,612 m** (right for
that ground), and Slope, Hillshade and Contours (27 features at 200 m) then
ran off it — the raster layer count going 0 to 1 and the rest following.
## Which of the 47 tools belong on a MAP page: the output type decides

Audited by reading what each descriptor takes and produces, then following the
result to where it lands. **42 of 47 produce a map layer** (18 vector, 24
raster) and are unarguably GIS work. **Five produce `outputType: "table"`** —
`zonalStatistics`, `histogram`, `rocAuc`, `successRate`, `confusion` — and the
runner says what that means in its own comment: *"outputType table returns
rows, registers no layer"*, returning `layer: null`.

**Those rows are then discarded.** tool-dialog's result handler reads
`result.message` and `result.layer` and nothing else; grepping every consumer
of `.rows` in the tree finds the extraction panel's own rows and tool-search's
UI list, and no reader of a tool result's rows anywhere. So on the GIS page
those five compute a real answer, print a one-line status, and throw the
answer away: no layer, no table, no export, no project file. That is the
concrete test for "does it belong here" — **a GIS tool's output is a map
layer, and a page that cannot hold the answer is not that tool's home.**

The five split three ways, and they are not the same case:

- **`rocAuc`, `successRate`, `confusion` — Research.** These score a MODEL
  against observations; they say nothing about the map. Research already has
  the home: `stats.js` (correlation, t-test, Mann-Whitney, KS, ANOVA, PCA)
  and the plotting the Analysis page uses, where a curve and a table can
  actually be drawn. A success-rate curve is a chart, and there is no chart
  on the globe.
- **`zonalStatistics` — belongs in GIS, and is the one to FIX rather than
  move.** "Raster values inside each polygon" is canonical GIS (ArcGIS's own
  Zonal Statistics), and its answer is keyed BY POLYGON — which means the
  right output is the polygon layer with the statistics written back as
  ATTRIBUTES, i.e. a vector output that draws, symbolises and exports like
  any other. As a bare table it is the right tool wearing the wrong return
  type.
- **`histogram` — re-home rather than move.** A raster's distribution is what
  you consult to CHOOSE CLASS BREAKS, so its natural place is the symbology
  dialog beside the classing it informs, not a geoprocessing tool whose table
  evaporates.

Two entries look like they belong elsewhere and do not: `randomSample` and
`stratifiedSample` sit in the Validation category but output VECTOR points.
They are model preparation by intent, and they produce a layer, so the map
page can hold them honestly — category is not the test, output is.
## Buffers have SHAPES, and the multi-ring is graded on arrival

`GP.buffer(fc, m, { shape })` — "round" | "square" | "flat" — and
`GP.multiRingBuffer(fc, [m...], { shape, rings })`, surfaced as the Buffer
tool's Shape select and the new Multi-ring buffer tool. What each word
honestly means per geometry, stated rather than discovered: points get
circles or axis-aligned squares (`squareAround`); lines get flat caps, SQUARE
caps (the corridor extended one distance past each end — ArcGIS's SQUARE end
type, done by extending the endpoints before offsetting), or ROUND caps built
by UNIONING end circles onto the flat corridor — stitching semicircle arcs
into the ring by hand is exactly the seam arithmetic the boolean ops exist to
avoid. A polygon outline is offset along its own boundary whichever shape is
asked for; "square" does not mean a bounding box and the param blurb says so.

**Multi-ring bands are TRUE RINGS by default** (each disk minus the previous)
because solid nested disks STACK: three translucent fills over one centre
render the drawing order, not the distance. Each band carries `buffer_m` and
`buffer_min_m`; bands over colliding sources merge through the checked union.
Distances are cleaned, not trusted — sorted, deduplicated, non-positives
dropped.

**A tool may declare how its output is READ**: `paint: { field, ramp }` on
the descriptor, and `register()` grades the new layer through the symbology
dialog's own `paintByRange` (equal interval, one class per band, capped 12).
Dynamically imported so tool-runner stays Node-clean, and best-effort so a
failed paint never fails the run that produced the layer. This is the seam
any future tool with a self-describing output should use rather than
repainting from its panel.

Every constant checked against a closed form (square point 402 vs 400 km²,
square caps +402 vs +400, round caps +314 = one circle, annuli to a fraction
of a percent) — 14 checks in geoprocessing.test.mjs, which must sit ABOVE
that file's summary line: it calls process.exit, so anything appended after
it silently never runs.

**Distance bands are CATEGORIES that happen to be numbers.** The multi-ring
paint first graded `buffer_km` with equal-interval classes — one class per
band only when the distances are evenly spaced. Typed into the dialog as
"5, 15, 40", the breaks fell at 16.67 and 28.33: the 5 and 15 km bands shared
a colour under a legend claiming three classes, and one class contained no
band at all. `paint.discrete` colours one class per DISTINCT VALUE (ranked
along the ramp so near-to-far still reads as a sequence), labels each with
its own span off `buffer_min_km` ("5–15 km"), and re-sorts the legend by
distance — categorical legends order by frequency, and for rings frequency
is meaningless. Found only by driving the DIALOG with a custom list; the
seam test used even spacing and could never have shown it.

**Units are km at the tool boundary, SI underneath.** Buffer's Distance and
Multi-ring's list are kilometres, converted in the engine call; features
carry `buffer_km`/`buffer_min_km` beside `buffer_m` because the legend is
read by a person ("10–20" is a distance, "10000–20000" is an axis label).
When a param's unit changes, grep the BLURB too — the tool's still said
"metres" after the field said km, and a field disagreeing with its blurb is
how a unit bug gets typed in.

**Two realm traps in one verify loop, both already documented elsewhere and
both walked into again.** `import()` in the harness's top realm gets a module
whose `window` has no GeoIDImportManager — "Input is required" from a layer
that plainly existed; import in the IFRAME realm (`fw.eval("import(...)")`).
And after a reload the spin is BACK ON: a hand-placed camera then reads as
the zoom "throwing the view away" when it is the planet turning under a
paused probe that never re-paused it. The layer drawer's own
`frameLayer` is the reliable way to a layer; hand-building camera positions
against the zoom easing is not.
## Extraction within ANY polygon, from every active layer

Extract From Layers packages a study area: a **Within** select (the drawn or
boxed area, or any loaded POLYGON layer by name), tick lists per dataset with
per-column folds, and Run producing one package — the sample grid, every
ticked vector layer truly clipped, every ticked point cloud filtered. Export
CSV / Export GeoJSON write the WHOLE package, one file per layer, each filed
into the open project through `downloadText`. `window.GeoIDExtraction`
(`run`, `getLastPackage`) is the Model Builder's seam — a package is
`{bounds, grid, vectors, clouds}` already cut to the study area.

- **`overlay()` dropped LINES whole in clip and ALL points in difference.**
  Clip kept a line only if a vertex was inside (a crossing transect vanished);
  difference had no point branch at all. `clipLineToMasks` cuts each segment
  at every mask-edge crossing and classifies runs by midpoint (holes
  honoured); points are kept by containment in BOTH modes. Pinned closed-form
  in geoprocessing.test.mjs: clip of [-1,0.5]→[2,0.5] through the unit square
  is exactly [[0,0.5],[1,0.5]] and the difference is the two outside stubs.
- **A point cloud extracts from the FILE, not the renderer.** The delimited
  reader keeps `layer.source` (the table window's seam); `extractDelimitedWithin`
  re-parses it, so every column the file had is a tick — not the x/y/z/mag
  the renderer kept. `delimitedColumns` is the ONE naming rule (header row,
  else `column_N`) shared by the panel's tick list and the extractor, and
  lat/lon always ride along whatever is unticked.
- **The bounds layer excludes itself** from the vector list at run time —
  clipping a polygon by itself returns itself, which is a copy, not an
  extract. Drawn bounds have no layer id, so there every polygon layer
  (the captured study area included) is an ordinary extract subject.
- **Fields narrow properties, never geometry**, and `fields: null` means
  "all" — the panel passes null when every column is ticked, so a layer
  with more properties than the FIELD_CAP lists is not silently stripped.
- **`pointInAnyRing(lat, lon, rings)` — LAT FIRST.** The test suite itself
  passed (lon, lat) and read a correct membership function as broken for a
  round; the extraction module speaks {lat, lon} objects and lat-first calls
  throughout, unlike GeoJSON's [lon, lat].

**The workflow test (new project -> geology + elevation -> 10 km box ->
extract -> export) found two more per-body faults**, both invisible on Earth:
the rocky worlds all hold `getGeologyFeatureAtLatLon` internally and NONE put
it on the seam, so the extraction's geology tick wrote an empty column on
every planet (the seam entry closes over `geologyInteractiveState`, live once
that world's geology map loads); and `extractPolygonSamples` converted its
step with Earth's 111.32 km/deg everywhere, so a 0.5 km grid on Mars was
really 0.27 km — 1,444 rows claiming a resolution nobody asked for. The step
now derives from `viewer.bodyRadiusKm` (pi*R/180). Measured after: Mars 21
rows over a 10 km box, step 0.5000 km on Mars's radius, geology 430/430
("Mixed layered sedimentary rock"), export filed in `mars/extract-wf-mars`'s
own exports/. The grid's elevation and geology are the SAME uniform-ground
grid by construction — one table, one resolution, no interpolation step.

**The five rocky planet pages still carried the dead `#gis-extract-modal`**
that Earth removed — the second instance of the documented id-collision:
`getElementById("gis-extract-run")` found the modal's button first, the
shared panel's listener bound to it, and Run Extraction did nothing on any
planet while every list around it rendered perfectly (renders look elements
up per call; wiring happens once at init). The modal markup is gone from all
five, their Extract buttons open the Extract From Layers panel (via
`GeoIDSidePanels.open("analysis")` — on the planets the section lives in the
workbench, so un-hiding the section alone is not enough), and the modal-only
wiring is removed so the freed ids cannot rebind to the panel's controls.
When a shared-panel control is dead on ONE lineage of pages, count its id
(`querySelectorAll`) before reading any code.
## Every input brings its best data for the run's ground

`refineFor(bounds)` is the contract the tool runner puts to every input before
any run that has a ground. The geology clip proved the shape — use what is in
hand to learn WHAT is there, then fetch the real thing for the area — and the
answer differs by KIND rather than by tool, so it belongs on the layer:

- **Earth Engine** renders a fixed pixel budget over whatever extent it is
  given and takes no scale parameter, so a smaller extent IS the refinement.
  `bestDimensions` asks for one pixel per native pixel, clamped so the service
  is never asked for detail the dataset does not hold; `overlapBounds` keeps
  the request to ground the layer actually covers. A CACHED snapshot says there
  is nothing finer rather than making a billed call for the same pixels.
- **WFS** is already exact geometry, so "highest resolution" means something
  else: the fetch ran under a feature COUNT cap, and what a cap cut off is
  whole features missing. It re-asks with a bbox, and only when truncated.
- **An imported file** answers that it is already native. Saying so matters:
  "nothing finer exists" and "nobody asked" look identical in a result message.

A layer answers by SWAPPING IN its better data and leaving `restoreLive`
behind, so `giveBack` puts the map back — a clip must not shrink the layer it
was cut from.

And the refine works out its OWN ground. `refreshLiveInputs` answers with a box
only when some input streams features, so gating on that box meant a run whose
only refinable input was a GEE layer never got asked: measured with a stub
through the real clip, `refineFor` called zero times and the message silent.
## "Ready for QGIS" and "ready for ArcGIS" are different bars

`ogrinfo` is the arbiter — it is what QGIS reads through, and it is on this
machine. Put a real export through it before believing anything about a
shapefile.

The writer itself was sound: a 10 km clip of Macrostrat read back as valid
polygons in WGS 84 with every attribute, and holes, multipart geometry and
reversed ring winding all survived. What was NOT ready was everything around
the geometry:

- **The name.** A shapefile's base name becomes the LAYER's name wherever it
  is opened, and ArcGIS holds feature class names to the coverage rules —
  letters, digits, underscores, not starting with a digit. The clip tool names
  its output `clip_World geology (Macrostrat)`, so the export carried spaces
  and brackets. OGR opens that happily; ArcGIS will not take it into a
  geodatabase. QGIS tolerating it is precisely why it looked fine.
- **The zip date.** All-zero DOS date fields mean month 0, day 0 — not a date.
  `unzip` prints "1980-00-00" and stricter readers reject the entry. Write the
  format's epoch in the local header AND the central directory.
## A shapefile can be perfectly formed and still not draw

QGIS crashed on an export that passed every structural test: headers, the .shx
index, per-record and file bounding boxes, ring closure and winding, DBF
arithmetic, UTF-8 cells, the .prj through PROJ, strict zip integrity, and a
full `ogrinfo` read of all 257 features. None of it found the fault.

What found it was rewriting our own output through `ogr2ogr` and DIFFING THE
BYTES. GDAL reordered and reversed rings in exactly four records, and those
records held the problems:

- **rings enclosing zero area** — collapsed slivers from clipping a polygon
  along its own edge. 2 exactly zero, 9 more under a square millimetre, out of
  493. Dropped before writing.
- **orphaned holes** — `partsOf` made every ring after the first a hole because
  GeoJSON says so, and the geoprocessing does not keep that promise. Holes are
  now decided by CONTAINMENT; a ring outside the shell becomes its own part.
- **spikes** — a path out and back along itself. Removed.
- **rings that touch themselves** — still there, 7 of 257, every reported
  intersection ON the study area's edge. Sutherland-Hodgman is exact for a
  convex window and still joins the pieces of a CONCAVE polygon along the
  boundary.

**Do not repair a pinched ring by splitting it at the repeated vertex.** Tried:
the two lobes are both SOLID, the smaller was then judged a hole by
containment, and 5.5% of the mapped area disappeared (1.26902535 to 1.19963401
in square degrees). Reverted. A proper repair is a noding pass in the clip
engine. Until then the export COUNTS them and says so.

`ogrinfo`, GEOS validity, and pyshp each tolerate different faults, so agreeing
with one proves nothing. Diff against GDAL's own writer.
## `geoprocessing.difference` is not safe to believe

The clip's north-west quadrant was empty and Macrostrat had data at every point
in it — two units, sources 147 and 154, at all six sampled coordinates. Staged
measurement over a 47 km box at Inishowen:

| stage | quadrant covered |
|---|---|
| world layer's tiles, source 147 (791 features) | 98.3% |
| the 726 API units those tiles name | 100% |
| those units clipped to the box (16 features) | 100% |
| **after subtracting the finer survey** | **84.8%** |

The finer survey covers **1.5%** of that quadrant. Subtracting it took 15% of
the coarse survey's ground there and 44% across the whole study area. `overlay`
subtracts each mask polygon in turn with a Sutherland–Hodgman routine, exact
only for a **convex** clipper; survey units are not convex, and eighty
sequential subtractions compound the error. **Nothing failed** — a wrong answer
and a right one are both FeatureCollections, which is why this was reported
three times as "missing polygons" with no error anywhere.

`dropOutranked` now cuts one feature at a time and CHECKS the answer: sampled
points inside the feature and inside no finer survey are ground the cut owes
back, and a result that no longer holds them is thrown away and the feature
kept whole. Measured after: box coverage 77.6% → **100%**, the quadrant 23.8% →
**100%**, at the cost of 21.3% of the box being double-covered — and the picker
still answers with the finest survey on **341 of 341** overlapping cells,
because picker order is finest-first and independent of this.

**An overlap is the lesser fault.** It is visible, listed, and can be argued
with; a hole in a geological map reads as "no data here". The real repair is a
boolean engine correct for concave clippers — a vendored clipper, which is a
dependency decision, not a fix to make quietly.

Do not use `GP.difference` as a truth source anywhere else without the same
verification. The same routine underlies `clip` and `intersect`.
## The shapefile export, audited against GDAL

Reproduced headlessly — the same Macrostrat tiles fetched in Node, through the
same `geoprocessing.clip` and the same precedence pass, into the same
`buildShapefileZip`. That harness is worth rebuilding if this ever regresses:
it needs no browser, runs in seconds, and lets `ogrinfo` be the judge.

**The one real defect** was geometry, not format: `ogrinfo` reported **356 of
358 features valid**, the two failures both `Ring Self-intersection`, at
-6.813498/55.168917 and -7.012367/55.078367. Each ring carried one repeated
vertex enclosing a three-point spur of **exactly zero area**, with the
remainder holding **100%** of the ring. `unpinch` splits at the repeat and the
existing degeneracy test drops the spur. After: **358 of 358 valid**, area
0.6940937994316 against the source's 0.69409380 — unchanged to eight decimals.
Round-tripped ours → GDAL GeoJSON → GDAL shapefile → back: 358 / 358 valid /
same area at every hop.

**Everything else already conformed**, and the byte-level audit is recorded so
nobody re-derives it:

| | |
|---|---|
| .shp header | file code 9994, version 1000, **shape type 5 = Polygon (2D)** |
| Z / M ranges | all zero — a 2D file, not PolygonZ |
| file length | exact, in 16-bit words |
| .shx | 358 entries, 0 disagreeing with the .shp |
| .dbf | dBASE III (0x03), header + n×record + 1 = file size exactly, 0x0D terminator |
| fields | 22, names unique and ≤10 chars, types C and N only, longest C 127 (limit 254) |
| .prj / .cpg | ESRI WKT for WGS84 / UTF-8 |

**`countSelfTouchingRings` counts what ARRIVED, not what is written** — the
writer repairs them now, so counting the output would report zero however bad
the input. It removes spikes first: a spike repeats a vertex too, and counting
before that step said 87 rings on a clip where 2 were genuinely pinched.

Note the local GDAL's Python bindings **segfault** on `from osgeo import ogr`
while the CLI tools work. That is a sick GDAL install on this machine, and it
is the same stack QGIS sits on — worth remembering next time a file "crashes
QGIS" and passes every check here.

### The 10 km acceptance run

Clip 10 × 10 km of the world geology, export SHP, import it back — measured end
to end, with the exported bytes then handed to GDAL:

| | source clip | re-imported |
|---|---|---|
| features | 8 | 8 |
| rings | 8 | 8 |
| area | 124.288 km² | 124.288 km² (**0% drift**) |
| colour column | `color` | `COLOR` |
| legend | 678F66, A6A6A6, 8CB06C, 9AD9DD | in the survey's colours, labelled by unit |
| pinched rings | 0 arrived | 0 written |

The zip is 8,104 bytes with all five members. GDAL on those exact bytes: driver
ESRI Shapefile, **Geometry Polygon, 8 features, 8 valid**, extent equal to the
box, attributes intact including `COLOR = #FF9BCD`.

**The area sum exceeds the box on purpose.** 124.29 km² over 100 km² is **24.3%
of the ground covered more than once** — coarse features kept whole because
their cut could not be made safely. It costs nothing on screen or in a click,
and it double-counts in an area sum or an attribute table. That is the standing
trade until there is a clipper correct for concave subjects.

### Why a drawn outline floated and the world layer's did not

Rings reach the SEAL only when a colour is available; without one they fall to
the lifted line buffer, which carries the altitude-scaled clearance. The tiled
world layer always passes `colourFor: paint`, so its boundaries have always sat
on the ground. An outline-only layer went through the FIRST render uncoloured
and so was drawn as lifted lines — measured, **467 m above the ground at a
23 km view, 11.9 km from orbit** — until the scheduled default paint landed a
tick later and dropped it onto the surface. A layer whose default paint never
ran stayed up there for good.

An outline has no fill to defer, so it is now painted in the first pass. The
two-pass build stays for FILLED layers, which is what it was written for —
triangulating the BGS sheets inside the import took it from seconds to over
five minutes — and a test pins that so the reason is not lost.

**When an outline floats, look at whether it reached the seal.** Fill and seal
are at drape 0; only the line buffer is lifted, and rings land there whenever
`colour` is missing.
## A zip is how a shapefile travels, so it is how one arrives

A shapefile is four to seven files that must stay together, which is why this
app exports one as a zip — and then asked the reader to unzip it and pick the
.shp out by hand. `polygons.js` even advertised `.zip` in its picker, so the
file could be chosen and then not opened.

Archives are expanded in `expandArchives` before anything else looks at the
list, so a member is grouped with its sidecars by the same rule a loose file is
and no parser ever sees a `.zip`. Verified both ways:

| | stored (ours) | deflated, inside a folder |
|---|---|---|
| zip | 18,576 bytes | 5,923 bytes |
| layers added | **1** | **1** |
| unsupported rows | 0 | — |
| features / colour / legend | 8 / COLOR / named | 8 / COLOR / named |

Three things that make it one layer rather than seven:

- `qml` and `sld` had to join `SIDECAR_EXTENSIONS`. They are the styles this
  app now writes beside a shapefile, and as primaries they landed as an
  "unsupported" row apiece.
- Folder paths are flattened to the file name. The grouping keys on the base
  name, so `a/roads.shp` and `a/roads.dbf` would otherwise be different groups.
- DEFLATE is the normal case for a zip written anywhere else.
  `DecompressionStream("deflate-raw")` inflates; a member it cannot read is
  skipped rather than failing the archive.

An entry whose local header says zero because its sizes trail the data is
refused with a message rather than read as empty — every zip this app writes
carries its sizes up front.
