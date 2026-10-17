# Themes (skins) and membership gates

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## Themes: five arcade skins, chosen in Settings, and what a theme can reach

`Settings ▸ Theme` offers the default plus five arcade skins. The whole thing
is ONE ATTRIBUTE — `data-skin` on `<html>` — which `styles/viewer-themes.css`
hangs every palette and every signature rule off, and `scripts/theme.js` is
the only thing that writes it. Switching is an attribute flip: no stylesheet
to load, nothing to unload, no flash.

**It is a token file because the tree was already token-driven.**
`viewer-skin.css` resolves every rule through eleven palette tokens — that is
what makes the Etna ember variant a colour swap rather than a second copy —
and the GIS panel CSS reads `--nav-accent` in **242 places with no hard-coded
magenta anywhere**. So a theme is mostly a restatement of those tokens, and it
reaches the nav bar, the panels, the cards, the dialogs, the legend, the
Workspace tile and all sixty-four Research Hub pages (whose `atlas.css`
already resolves through `--skin-*`) without one of those files being edited.

**What a palette cannot say is the structural half**, so each block carries
its own short list: a pixel theme has no radius anywhere, a CRT has a fixed
scanline overlay, a cabinet has hard-offset bevels instead of bloom. Aimed at
the SAME structural classes the base skin already targets, with the same
`!important`, for the same reason.

Three things had to stop being literals first, and each was a real gap:

- **The GIS panels wrote the DATA colour out 55 times** (`#52e4e8`,
  `rgba(82, 228, 232, …)`). That is a theme axis — the CRT's data colour is
  amber and the pixel theme's is NES blue — so they became the token they
  already were everywhere else.
- **The SHELL had 39 hard-coded magentas and no tokens at all**, because it is
  the page AROUND the iframe and never loads `viewer-skin.css`. Its `--hub-*`
  names resolve through the skin's now, so a theme does not stop at the iframe
  edge.
- **The Research Hub's own faces were literals**, so its 64 pages kept the
  site's type under a theme that had changed everything else.

### The three things that were measured rather than assumed

- **A module cannot apply a theme.** A module is deferred by definition, so a
  themed page paints once in the old palette and switches a frame later —
  exactly the flash a picker exists to avoid. `theme.js` is a plain script in
  `<head>` and stamps at parse time. That costs one blocking kilobyte, and
  that is the price of not flashing.
- **The DEFAULT carries no attribute at all.** Not a sixth palette that
  happens to match: with nothing stamped, the base skin applies exactly as it
  did before any of this existed, which is what makes the default a true
  no-op.
- **`?skin=` had to cross the iframe by being ASKED for.** The shell stamps
  itself in `<head>`, which is before its iframe exists, so there was nothing
  to tell — measured, a `?skin=crt` shell around a default viewer. A framed
  document asks its parent on the way up and the parent answers with what it
  is SHOWING. Storage covers every other case, because two same-origin
  documents read the same `localStorage`.

A `?skin=` in the URL wins for that load and is **not persisted**: a link that
rewrote what the person who opened it had chosen would be changing their
settings rather than showing them a theme. It also makes the whole set
screenshot-able in one loop, which is how the live comparison sheet was made.

**THE GeoID MARK IS NEVER RESTYLED.** Last rule in the file so nothing above
can reach it: no theme filters, tints or blends the logo, and the test pins
that on the source. Each design makes room for it instead — the cabinet puts
it on a cream marquee, the CRT makes it the badge on the monitor's chin, the
pixel theme frames it as a cartridge label.

**What a theme does NOT reach, and should not.** The public site's own header
(`site-nav.css`) stays in the site's colours — it is the website around the
app, not the app. And nothing themes the DATA: a geological map keeps the
survey's own published colours, a glacier legend keeps its measured scale.
Those are the map, not the chrome.

### What a theme could not reach, and the light one that found it all

Six skins now (the cabinet marquee was dropped; the "Arcade —" prefix went with
it, since half of them are not arcade). Adding a LIGHT theme was worth more
than the theme itself: **the beige box is a value inversion, so every surface
that assumed a dark ground announced itself at once.** Four kinds turned up.

- **TWO OPAQUE GROUNDS, written out as literals in seven modules.**
  `rgb(16, 7, 36)` and `rgb(24, 13, 47)` are the tab body and the sub-tab card
  — filled solid on purpose, because `#ui` paints a vertical gradient and the
  same translucent fill composites differently at the top of the column and at
  the foot. No theme could reach them: measured under the beige skin, the
  purple-black card was still sitting on a grey panel. They are
  `--skin-tab-ground` / `--skin-card-ground` now, defaulting to those measured
  values, so the default theme is byte-identical.
- **Popup and window palettes**, twenty-two literals across `feature-popup`,
  `panel-styles`, `tool-dialog` and `symbology-dialog`. Each mapped to the
  token it already meant. `#8a8a8a` (the no-value grey) and the default line
  colour were deliberately LEFT: those are data semantics, not chrome.
- **The clock's housing**, which is why the beige theme first drew navy digits
  on a near-black plate.
- **Three DRAWN surfaces that no stylesheet can reach at all** — see below.

### A canvas asks the theme what colour it is

The seven-segment clock, the map's label chips and the hover highlight on the
globe are painted by a canvas or a three.js material, so they stayed in the
default palette under every skin. `GeoIDTheme.token(name, fallback)` and
`.hex()` let them ask, which keeps ONE source: the same `viewer-themes.css`
block that paints the panels.

Each has its own token — `--skin-clock`, `--skin-chip`, `--skin-hover` — with
the value it drew before themes existed as the fallback, so the default draws
exactly what it always drew and a theme opts in by restating one line.

- **The clock has to be INVALIDATED on a theme change.** It redraws only when
  the text changes, and a theme change moves no digit — so it kept the previous
  colour until the next second ticked over, and on a paused clock for ever.
  Measured off the canvas pixels: `63,224,230` → `93,255,155` on the switch.
- **Only the CURATED label chip follows the theme.** A dataset label already
  takes its accent from its own layer's legend (`label_colour`), and a
  volcano's chip wearing the theme's colour instead of its class's would be a
  theme overruling data.

### Theme sounds: synthesised, off by default, and only on controls

Six themes want six clicks, and six audio files would be six downloads, six
licences and six things to keep in step with a palette. Each voice is a row of
oscillator parameters in `scripts/theme-sound.js` instead — a soft blip for the
CRT, a two-step square for the pixel theme (the era's hardware could not
glide), a sine ping for vector, a saw stab with a fifth under it for outrun,
filtered noise with no pitch at all for the beige box's mouse tick, a rising
two-tone chirp for the HUD.

Three rules, and each is the difference between a nice touch and something
switched off in a fortnight:

- **The default theme is silent.** Sound is a thing a theme brings, not a thing
  the app starts doing to somebody who never asked for it.
- **It is off until switched on**, beside the theme picker, and switching it on
  plays the theme's own click — a silent confirmation is indistinguishable from
  a broken one.
- **Only controls make a sound.** A click on the globe, a drag or a text
  selection is silent: the listener asks whether the target is a button, a tab,
  a tick or a select first. It listens on `pointerdown`, not `click`, because a
  control that feels instant has to sound at the press.

The AudioContext is made on the FIRST click and not before: a browser refuses
one outside a gesture, and one made at load leaves a suspended context running
for every reader who never turns sound on.

### "The hover and the sound are the same in every theme" — both were true

Two reports in one line, and neither was where the theme work had been looking.

**THE HOVER WAS A VIOLET LITERAL IN TWENTY PLACES.** `rgba(190, 120, 255, …)`
in `styles.css`, plus `#be78ff` and `#f3e6ff` — a luminous violet chosen to sit
apart from the column's magenta, and therefore the one state that looked
identical in every skin. It is `--skin-hover` / `--skin-hover-rgb` /
`--skin-hover-ink` now, and each theme gives it its own. The map's outline
under the cursor is a SEPARATE token (`--skin-hover-map`): they have different
defaults and different jobs, and the row hover is the one a reader sees a
hundred times an hour, so it keeps the bare name.

**THERE WERE TWO SOUND SYSTEMS, AND THE ONE PLAYING WAS NOT THE THEMED ONE.**
`scripts/ui-sound.js` predates all of this: it is loaded by every viewer,
**enabled by default**, and already owns the hover tick, the rate limiting, the
control selector, the disabled and `data-no-sound` opt-outs and a mute API.
Adding `theme-sound.js` beside it meant two clicks on one press, with the
reader hearing whichever fired first — which is exactly what "the sound is the
same in every theme" sounded like. The second file is deleted; `ui-sound.js`
carries a VOICES table keyed by `data-skin`, whose `default` entry is the
values it has always played, so a reader on the GeoHUB theme hears no change.

The rule this is the third instance of: **before adding a capability, grep for
it.** The clip button, the extraction dialog, and now the click sound.

### A light theme is an audit nobody has to write

The beige box inverts the value scale, so every surface that assumed a dark
ground announced itself. Measured with a contrast walk — first opaque ancestor
as the ground, flag anything under 0.16 luminance apart — it went **79
unreadable elements to 14**, against a floor of **9 in the DEFAULT theme by the
same instrument**, so what is left is mostly the instrument's own optimism
about translucent controls.

What the 79 actually were, in order of how well they hid:

- **70 palette literals in the modules' own CSS-in-JS `STYLE` blocks** across
  19 files — the ⓘ button, the events glyphs, the draw HUD, the dialogs. The
  earlier pass had tokenised `styles.css` and `shell.css` and stopped there.
- **Nine more near-black GROUNDS** written per component: the Workspace layer
  row, the Legend toggle, the zoom pill, the corner cards.
- **One INLINE STYLE in the markup** — `style="color: #6fd6ff"` on a label.
  An inline style outranks every rule, so that one label stayed cyan on grey
  while everything around it changed. When one element resists a theme and its
  neighbours do not, read its `style` attribute before its stylesheet.

**Four category labels were deliberately LEFT.** Volcanic red, landing amber,
habitation green and the white moons say what colour their labels are drawn on
the globe; recolouring them to suit a theme would break the correspondence
between the tick and the map. The same goes for the event glyphs and the
no-value grey. A theme dresses the chrome; the data keeps its own colours, and
on a light ground some of them are genuinely low contrast — that is a cost of
the light theme, not a bug in it.

### A GROUND CAN BE A GRADIENT, and `backgroundColor` will not show it

The geology card MEASURED as a light card under the Workstation theme and
RENDERED dark — `backgroundColor: rgb(223, 223, 223)`, and a dark plate on
screen. Its ground is a `background-image`:

    linear-gradient(180deg, rgba(18, 28, 38, 0.95), rgba(6, 11, 17, 0.985))

painted over the colour. The colour had been tokenised; the gradient had not,
and the probe that read `backgroundColor` reported the fix as landed. Two
rounds went into looking for a dark CHILD that did not exist.

**When a surface refuses a theme, read `backgroundImage` before believing
`backgroundColor`** — and when a measurement says a fix landed and the
screenshot disagrees, the measurement is reading the wrong property.

**An open legend head is FILLED, so its ink is white.** The same pass forced
every `.legend-entry-head` black for contrast on grey and put black on navy on
the one entry that was open — which is the one being read. Scoped to
`.is-folded`, with `:not(.is-folded)` taking white, exactly as an open tab
already does. A blanket contrast fix has to ask which STATE it is fixing.

**"Beige box" is "Workstation" now**, and the ID stayed `beige`: an id is a
storage key, and renaming one is a migration for every reader who has already
chosen it — the lesson `sea-level-section` records.

**And its click became a mouse click.** The first voice was a low square pair
(240/180 Hz), which is a boop; a workstation's button is a dry mechanical tick,
so it is short, high and almost pitchless (3100/2200 Hz at 18 ms). The voice is
part of the theme's identity, not a decoration on it.

### A borrowed shell is a snapshot

The workbench panels are the SIDEBAR rather than a likeness of it —
`adoptSidebarShell` reads `#ui`'s COMPUTED style and writes the resolved values
inline, which is what makes Settings and Export look like the column on the
other side of the screen. It also freezes them: the panel keeps whatever theme
was live when it was BUILT, and an inline style beats every rule, so no
`[data-skin]` block could correct it. Reported as the Settings header stuck on
Workstation grey over a panel whose body had gone back to magenta.

Re-borrowing on `geoid:skin-changed` is the whole fix — the sidebar has already
restyled by the time the event fires, because a theme is a stylesheet switch
rather than a transition, so one pass is enough. Verified through four
switches: ground, title ink, border and font all follow, and returning to the
default lands on the original values exactly.

**The general shape, and it is the third kind of surface a theme could not
reach.** A canvas cannot read a stylesheet; a gradient hides behind
`backgroundColor`; and a computed style COPIED into inline CSS stops tracking
the thing it was copied from. Anything that snapshots a resolved value needs an
invalidation hook, and the theme's own event is it.

### A workbench outlives the page that opened it

The four workbenches — Geoprocessing, Analysis, Export, Settings — are
`position: fixed` sections on `body`, so standing the SIDEBAR down does nothing
to them. One left open in GIS then sat over the Model studio and the Research
Hub, which own the whole screen. `applyMode` closes them on the way out of GIS
(`GeoIDSidePanels.closeAll()`), and CLOSES rather than hides: coming back
should not restore a panel somebody had finished with.

### The Research Hub under a light theme

Two faults, both the same shape: a token that means one thing on a dark panel
and the opposite on a light one.

- **`--atlas-wash` is an 18% tint of the chrome.** Over a dark panel it is dark
  and white ink reads; over a light one it is still light and white ink
  vanishes — measured at **1.3:1** across the rail names, the shell actions,
  the page pills, the repo selection and the build steps. Six rules wrote
  `color: #ffffff` directly. They read `--atlas-wash-ink` now, which resolves
  through a skin token, so a theme flips all six in one line.
- **`--skin-bg` is the DESKTOP, not the hub's ground.** On the Workstation
  theme it is the teal a 90s window sits on — right for the globe's page, wrong
  for a full-screen hub, where the rail and the shell row took it and stayed
  dark while every panel between them went grey. The hub gets a window ladder
  instead (ground → panel → card), which is what makes a page of that era read
  as depth rather than one sheet. It needs `!important`: `atlas.css` declares
  those on `#research-hub` and is injected at RUNTIME, so it lands after
  `viewer-themes.css` in the cascade.

**Measured across all seven themes on the Ingest page**, `.button` at 1.0–1.2
appears in EVERY theme including the default — those are translucent controls
whose own fill the contrast walk cannot see through, and they are the
instrument's floor rather than a fault. Against that floor of 6, the light
theme now measures **2**, which is the cleanest of the seven.

**The rule for auditing a theme: run the DEFAULT through the same instrument
first.** Without that baseline the six false positives read as six bugs, and
the two real ones are lost in them.

### The planets have their own copy of everything, themes included

Reported as "the Workspace is different on the planet viewers", and it is the
fork showing through: Earth reads `viewer/styles.css`, the nine planets read
`gis/shell.css` plus a per-planet `styles.css` each. A tokenisation pass on
Earth's stylesheet therefore reaches EARTH ALONE, and the dark grounds stayed
in the planets' copy — the dock, its layer rows, the plot boxes, the planet
strip.

Fixed in three places, and the reach of each is what decides where a literal
costs the most:

- **`gis/shell.css`** — 15 grounds and blooms. One file, nine viewers.
- **`styles/viewer-skin.css`** — the Tour Enter button's ink. One file,
  ELEVEN viewers, so a literal there is eleven viewers wrong at once.
- **The nine per-planet `styles.css`** — the wordmark's ink (`#d0dbe0`) and
  the dark stroke behind it, one occurrence each. The stroke follows
  `--skin-vignette` rather than staying dark, because on a light theme a dark
  outline round a dark wordmark is what keeps it legible.

**`theme.test.mjs` now checks BOTH stylesheets for the same list of ground
literals**, and every planet for the wordmark token. That is the guard that
matters: the fork cannot drift back one file at a time, and running the check
immediately found six MORE in Earth's own copy that the first pass had missed.

**And the audit instrument has a floor per page, so read it as a delta.** On
the Neptune viewer the default theme measures 2 by the contrast walk, and the
elements it flags come back readable when probed individually — translucent
controls and headings whose ground the walk resolves optimistically. Compare a
theme against the DEFAULT's number on the same page, never against zero.
## Membership: what is gated, and which gates are real

The site stays open to LOOK at. What membership unlocks is the work — the risk
maps this app models itself, and keeping a project — and **nothing of anybody's
reaches us**: a project is their folder, their browser storage, or their own
machine through the sidecar. Membership is an entitlement, not a place we put
somebody's study, which is the whole of what a privacy notice for it has to
cover.

**TWO KINDS OF GATE, and `gis/membership.js` says which is which rather than
letting a caller assume.** A gate written in the browser is a COURTESY — the
site is static on GitHub Pages, and anybody can open devtools and flip it. The
one place enforcement is possible is a server we own, and there are two: the
Earth Engine Cloud Function (billed per render, deliberately NOT gated) and the
R2 bucket.

**SIX OF THE TEN MODELS ARE NOT FILES OF OURS.** Sea level, both river floods,
the corridor zones and the two forecast pipelines are computed IN THE BROWSER
from the streamed DEM, GRWL's rivers, the coastline and HydroLAKES — other
people's open data, which we redistribute and which is theirs to give away.
There is nothing to refuse, so their gate is the courtesy one and always will
be. Only the four baked grids (cyclone, seismic, and both volcanic) are ours
and are enforced, at `services/data-gate`.

**What is behind it comes from `equations.js`'s own division**, rather than a
list somebody typed: a layer marked "computed here" is one we model, one marked
"modelled elsewhere" is somebody else's published product (Pelletier's
thickness, WorldPop, the MERRA-2 normals). The DEM readings are computed here
and stay open on purpose — looking at the shape of the ground is exploring.
**Gating somebody else's open data by accident is a licence problem rather than
a bug**, so `data-gate/worker.test.mjs` pins the OPEN side as hard as the
closed one.

**LOCKED IS THE DEFAULT, and the opposite rule was measured to be wrong.**
"No auth service configured means every gate stands open" shipped first, on the
reasoning that a gate must not lock the app before the sign-in exists. True —
and it made every lock INVISIBLE on the one machine where they were being
built, so the report was "there's no change". In the absence of a membership a
feature is locked; **a lock nobody can see is not a lock.**

Naming an auth service is what makes SIGNING IN possible. It is not what makes
the gates exist. Two deliberate ways out rather than an accidental one:

    <meta name="geoid-membership" content="off">   a deployment with no gates
    localStorage["geoid:unlock"] = "owner"          this browser, for working

The second is a development key and weakens nothing that was not already weak:
every browser-side gate is a courtesy, and the one that is really enforced is at
the bucket, which does not read it. It reads as the master account, so the app
can say which it is.

**A LOCKED TAB GOES GREY.** A padlock alone was too quiet to register. What says
"you cannot use this" before anything is read is the CONTRAST dropping — the tab
desaturates and dims to half where its neighbours carry the accent — with the
lock at full strength inside the dimmed row, which makes it the reason rather
than the signal. Forced with `!important`: a tab's own state rules (the accent
border, the filled header when open, the `has-active-data` fill) are written at
a higher specificity, and a locked tab must not light up underneath the lock.

**A GATE WITH NO DOOR NEEDS DIFFERENT WORDS.** With gates on before the Worker
exists, "sign in as a member" is an instruction nobody can follow: the nav
button keys on the auth SERVICE rather than on `enforcing()` and reads
"Membership", and the refusal says membership is not open for sign-in yet —
written WITHOUT the feature's title in it, because "Modelled risk maps IS part
of membership" is what templating one gives. That is the same fault twice; the
source pin on `refusal()` is what caught the second.

**A TEST UNLOCKS THROUGH STORAGE, NEVER BY CALLING `disable()`.**
`project-store.js` imports `membership.js?v=<stamp>` and a test importing it
bare gets a SECOND instance with its own flags, so the call turns the gate off
in a copy nothing reads. Storage is the one thing both instances agree about —
the module-identity trap, met from a new direction.

### A locked thing is SHOWN, never hidden

`feature-locks.js` is the other half of the gate: making a locked tab LOOK
locked, so nobody presses a control that is going to refuse them. Hiding it
would be easier and is worse — **a feature nobody can see is a feature nobody
knows they could have**, and the tab bar is how somebody finds out what this
app does. So a locked tab keeps its place, wears a padlock, and opens onto a
card naming what is behind it. The nav's own Membership button follows the same
rule: with no service configured it still reads "Membership" and goes to the
page describing it, rather than vanishing until the thing it advertises runs.

**THE MARKUP IS NEVER REMOVED.** Modules all over this tree read element ids
unguarded at boot (`geology-structures-toggle` is the one the notes name, and
there are a dozen more), so a lock hides a tab's contents behind a class and
puts a card in front of them. Unlocking removes the class. Nothing downstream
can tell the difference, which is what makes a sign-in mid-session work with no
reload — and it is why the locks are re-applied on a 900 ms beat as well as on
the membership event: these panels are rebuilt constantly.

**A FEATURE CAN BE TWO SURFACES, and locking one is locking half of it.** The
Model Builder is `gis-group-mesh` (the tab: study area → layers → surface →
domain → conditions → build) AND the MODEL mode button that opens the Meshing
Studio the package goes to. Locking the tab alone leaves the studio open; the
mode alone leaves the pipeline usable in a tab that feeds nothing. Before
locking anything, ask what else reaches it.

**A locked MODE falls back rather than refusing.** The stored view mode is what
the page boots into, so a member who lapses — or anybody opening a link somebody
sent them — would land on a page that will not load and has no way back.
`setMode` drops to `gis`; `feature-locks` explains it at the button, in the
CAPTURE phase, because mode-manager binds its own handler to the same element.
Not `disabled`: a disabled button takes no click, so there is nothing to explain
with, and the point of showing a locked control is that pressing it tells you
why.

**"Wiped" has to mean wiped.** `gee.js`'s `endpoint()` refused and cleared the
stored endpoint — but only when something happened to ASK, and on a page where
nobody opens that tab nothing ever does. It clears at load and on every
membership change now. This is tidiness rather than a defence: the endpoint has
never been secret (the module's own header says so, and what protects it is
`ALLOWED_ORIGINS` on the deployment), but a browser that may not use a billed
service should not be left holding the address of it.

### Locking a SUBTAB, not a tab

Locking Hazards whole shut the wildfire feed, the exposure map and the drought
rows with it — **none of which is ours to charge for**. The gate is on the nine
subtabs that hold what GeoID models itself (Rock properties, Sea level, myGeoID
mode, Landslides, Tropical cyclones, Seismic hazards, Volcanic hazards, Flood,
and the Model Builder TAB), and everything beside them in the same tab stays
open. `MEMBER_MODELS` maps a dataset id to its subtab's feature, so the gate on
a catalogue row and the gate on the subtab holding it are one decision.

**The MODEL PAGE is free; its nav-bar TAB is not.** The Meshing Studio is open
— build a mesh, boolean it, flag its surfaces, export a package. What is gated
is the pipeline that samples the REAL ground into a domain. `LOCKED_MODES` is
empty and says so, or somebody will helpfully refill it.

**A SECTION HEADER IS ONE OF THREE SHAPES**, and a lock hung off the wrong one
draws on a third of them: a bare `<summary>` on a `gis-tool-section`, a
`<summary class="section-toggle">` on a toolbox group, and a
`<div class="section-toggle">` on the myGeoID bar, which is not a `<details>` at
all. Only the middle one has `.section-title-row`. The mark is a real span
appended to whichever header is there, which also cannot collide with a pseudo
the panel sheets already use for a chevron.

**A CONTROL IN THE HEADER IS NOT IN THE BODY.** myGeoID carries its Enter button
in its header the way Tour Mode does, so hiding the body left the one control
that arms the mode live behind the lock card. Every control in a locked header
is disabled and MARKED (`data-lock-disabled`), so unlocking cannot re-enable one
that was disabled for its own reasons. `setHubArmed` refuses as the floor —
while standing DOWN is always allowed, or a member who lapses mid-session is
stuck inside the mode.

**A subtab needs an ID before it can be gated.** Five had none; an id survives a
panel being rebuilt or re-nested per body, which matching on a title does not.

### Credentials in a browser

Four are stored, and **none is a secret of ours**: the Earth Engine endpoint
(never secret — `ALLOWED_ORIGINS` on the deployment is what protects it), a
Google OAuth Client ID, the sidecar's host and its token (minted on the reader's
own machine), and an Atlas hub address. `credential-wipe.js` clears all four
when membership goes and at load, and `window.GeoIDCredentials.wipeCredentials
({ everything: true })` is the explicit form — the one to run on a machine that
has been used for testing before it goes live.

**The test pins BOTH sides.** A wipe that takes somebody's project, their pins
or their theme with it is one nobody runs twice, and the damage is silent.

**Nothing secret ships.** Audited: every secret-shaped hit in the tracked tree is
a form LABEL from the Qt spec, or the sidecar's own password refusal. Both
Workers read from `env` and neither `wrangler.toml` holds a value.

### The master account

`plan: "owner"` on a KV entry. It opens **every feature including ones added
later**, which is the whole reason it is a flag and not a list: a gate written
next year should not need somebody to remember to add the operators to it. An
owner is a member too, so nothing has to test for both.

It exists so the site can be used with **every gate ON**, exactly as a visitor
sees it, rather than only with membership switched off — which is the state
everything is otherwise tested in. The account page names it as itself, because
shown as an ordinary member there is no way to tell from inside the app whether
a gate is open because it is unlocked or because of who is asking. It still
expires: a credential that never runs out is one nobody ever revokes.

### Five chokepoints, chosen so a refusal is a sentence

`addDataset` (every catalogue tick), `addSheet` (the sheets are a MIXTURE, so it
asks by `spec.id` — which is the same id `equations.js` uses), the forecast
pipeline's Run (asked BEFORE the rain is fetched: a GEE render is billed and
refusing after spending one is the wrong order), `downloadText` (every export in
this app goes through it), and the project-folder doors. Only the CHOOSING of a
folder is asked, never the restoring: a session already open stays open, because
taking somebody's own folder away would be punishing and we could not delete it
anyway.

A gated row wears a chip and its name carries the sentence, because **a tick
that silently reverts reads as a broken control**, which is the worse failure.
The tick stays live: pressing it is how somebody finds out what membership is
for.

### The token, and the three places it could have gone wrong

- **IT COMES BACK IN THE URL FRAGMENT.** A fragment is not sent to any server,
  does not reach an access log, and does not travel in a `Referer`, all three of
  which a query string does.
- **ONE DOCUMENT HANDLES THE HANDOFF.** A fragment belongs to whichever document
  is on top, so a return straight to `/` would land the token on the
  SHELL while the viewer that needs it sits in an iframe. Every sign-in returns
  to `/sign-in/`, which has no iframe, and forwards from there; by then it is in
  `localStorage`, which every document on the origin reads. The return is
  same-origin only, checked at BOTH ends, because either alone is a single point
  of failure.
- **THE BUCKET PASS IS A SEPARATE, SHORTER TOKEN.** The bucket is read by
  three.js's texture loader and by geotiff's range requests as well as by
  `fetch`, and only a query string reaches all three — so that one is fifteen
  minutes, has its own audience, and cannot be used to ask who anybody is. The
  gate STRIPS it before going to the bucket: every object there is immutable for
  a year against a fingerprint in the path, and a token in the cache key would
  give each member their own copy of a file that never changes.
- **A 402 needs a CORS header of its own.** Without one it reaches the page as a
  bare `TypeError: Failed to fetch` with no status to read — the fault this file
  already records twice.

### What the tests caught before anything was deployed

- **A malformed token THREW out of `verify()`** rather than being refused:
  `atob` throws on anything that is not base64, and in a Worker that is a 500
  where it should be "not signed in".
- **The base64url decoder replaced `/` with `_`** — the ENCODER's direction.
- **`load()` in membership.js was a one-shot**, so a token written into storage
  from outside the module (the sign-in handoff, another tab) was invisible for
  the life of the page. `refresh()` is the saying.
- **A refusal templated from a title reads as "Modelled risk maps IS part of
  membership".** Each feature states both of its own sentences — signed out, and
  signed in but not a member, which are different things to say.

### Two things found on the way

**A default underneath is why a `!value` guard can be dead.** `project-store`'s
`mergeMetadata` spread `defaultMetadata()` underneath, whose `body` is always
`currentBodyId()`, so `if (!merged.body) merged.body = "earth"` was unreachable
and a project whose metadata predates the field took the world the PAGE was on.
THE DIRECTORY IS THE FILING, so `bodyOfDir()` reads it. Any
`{ ...defaults, ...payload }` merge has this shape; the fallback belongs in the
defaults.

**A test nobody runs is not a test.** `tests/run.mjs` swept `viewer/` alone, and
`services/gee-tiles/stac.test.mjs` had been sitting there passing and unrun. It
sweeps `services/` too now.

**A STUB IS NOT A DECISION THAT THE PAGE WAS UNWANTED.** Every page's header
linked to `/dashboard/`, which was a redirect stub — so I took it for the
account page, on the reasoning that a dead nav link wanted a destination. It is
exactly backwards: `/dashboard/` is the site's own welcome deck (the planet
carousel, the Etna and myGeoID slides, the mission deck, the news strip) and the
stub is what `726814fa80` left when it removed the ACCOUNT SYSTEM and took the
dashboard with it. The nav has gone on linking to it ever since because the nav
was right and the page was missing. Restored from `4ed02cbea5`; the account page
is `/account/`, which is where it always was.

**Before repurposing a path, read the commit that stubbed it.** The message says
what went and why — here, that `/account/`, `/sign-in/`, `/membership/` and
`/membership/welcome/` became stubs so Stripe receipts and bookmarks would not
404, which is a statement about links to keep rather than pages nobody wanted.
Two of those are a payment flow, and the classes the sign-in button needs
(`.nav-act-signin`, `.nav-act-member`) are still in `shared.css` waiting for it.

**A gate's own doorway must not be gated.** The membership button in the nav is
how somebody FINDS OUT membership exists, so with no sign-in service configured
it still reads "Membership" and goes to the page describing it, rather than
vanishing until the thing it advertises is running. Signed in it reads a first
name and never an email: a nav button is read over somebody's shoulder.

**`decodeURIComponent(escape(...))` THROWS, and a thrown decode reads as "not
signed in".** `membership.js` decoded a token payload that way; the service signs
with `TextEncoder`, so the pair is both deprecated and the wrong tool, and a
member whose name has an accent in it silently could not sign in. `TextDecoder`
over the bytes, which is what the Worker already used at the other end. Pinned in
Latin-1 and beyond it.

**And a backtick in a `git commit -m` is command substitution.** Two CSS class
names in a commit message were executed by the shell and replaced with nothing.
The same trap this file records six times for CSS-in-JS literals, met in the one
place nothing checks: write a message with backticks in it to a file and use
`-F`.
## Stripe writes the members list: the auth Worker's webhook

"What about a service worker that manages the memberships and checks the
credentials?" The auth Worker (`services/auth-worker`) already was that on
the CHECKING side — it signs in through Google or GitHub, looks the address
up in KV, and issues the week-long session token and the fifteen-minute
bucket pass. What it lacked was the WRITING side: the members list was
`wrangler kv key put` by hand. `POST /stripe/webhook` closes that.

- **Verified against the RAW body**, `t=<unix>,v1=<hex>` as HMAC-SHA256
  over `<t>.<body>` with the endpoint's `whsec_…`, refused past five
  minutes (a captured delivery replayed later is refused), compared in
  constant time, any of several `v1` accepted (a secret being rotated).
  The test builds the header with node's OWN HMAC, so a pass is two
  implementations agreeing on Stripe's scheme.
- **What each event does**: `checkout.session.completed` (mode
  subscription) grants a year; `invoice.paid` grants to the invoice's
  latest line-period end; `customer.subscription.deleted` shortens to the
  period end; `charge.refunded` ends it. All plus a week of grace — Stripe's
  own retry window for a bounced card. A one-off payment (a donation) is
  `not-a-subscription`. `stripe:event:<id>` for a month makes a retried
  delivery a no-op; `stripe:customer:<id>` → address lets a cancellation
  or refund, which carry the customer and not always the address, find its
  member.
- **AN OWNER IS NEVER LOWERED OR DOWNGRADED** by anything Stripe sends: the
  master accounts are ours, and a test purchase against one must cost it
  nothing. Pinned for a payment and for a refund.
- **The reply names the action and the type, never the address** — Stripe
  does not need it and a log line is not the place for one.
- **Without `STRIPE_WEBHOOK_SECRET` the route answers 503** and the list
  is written by hand as before. The Worker is NOT deployed: the KV id in
  `wrangler.toml` is a placeholder, no page carries the `geoid-auth` meta
  tag, and the Stripe endpoint has to be registered in the dashboard
  (Developers ▸ Webhooks, the four events above) — the README's Stripe
  section is the checklist, and every step of it is the account owner's.

### Sign-ups from Outlook and every other address

"What about sign-ups from Outlook etc.?" Google and GitHub were the only
doors, so a member who paid with an outlook.com, an iCloud or a university
address had none. Two doors added to the auth Worker:

- **Microsoft** as a third provider through `login.microsoftonline.com/
  common` (personal AND work accounts; the app registration must be made for
  that audience). A personal account's address is its `userPrincipalName`, a
  work account's is `mail`; a tenant GUEST's UPN is `x_gmail.com#EXT#@…`,
  which is nobody's mailbox and is refused.
- **A one-time link by email** (`POST /auth/email`, `GET /auth/callback/
  email`) for everything else: the one thing every member has is the inbox
  Stripe sent the receipt to. Signed, `aud: link`, fifteen minutes, single
  use (`link-used:<jti>` in KV), one a minute per address, sent ONLY where
  the address holds a membership, and the form answers the same sentence
  either way — the endpoint is neither a member directory nor a mail relay.
  The return address goes through `allowedReturn` before it is signed into
  the link. Sending is Resend's HTTP API (`RESEND_API_KEY`, `MAIL_FROM` on a
  verified domain); without it the door says so and the providers remain.
- Session issuance is ONE function now (`issueSession`), so a link and an
  OAuth callback cannot drift on the week cap or the membership re-read.

The tests monkeypatch `globalThis.fetch` to stand in for Graph and for the
mail service and read the link out of the captured message, so the whole
flow — ask, mail, follow, refuse the second follow — runs in node.
## Membership, live: a route is not a record, and a door nobody set up

The auth Worker was deployed, bound, secret-set and **unreachable for a day**,
and every instrument said it was fine. A `[[routes]]` block says "run this
Worker for traffic that arrives at this hostname" and makes nothing arrive:
`wrangler deploy` is green, the binding is real, `getent hosts` finds nothing.
What creates the DNS record AS WELL AS the binding is `custom_domain = true`
on the route — the dashboard's Add → Custom Domain, from the CLI. One
hostname cannot hold both, so the route goes.

**The page drew four doors and the service had one.** `GITHUB_CLIENT_ID` and
`MS_CLIENT_ID` are empty, so `/auth/start` built a redirect with an empty
`client_id` and the reader landed on GitHub's own error page — somebody
else's words, about our service, with no way back — and the email door
answered 503 after a press because there is no mail key. Which doors exist is
a fact about the DEPLOYMENT, so the page asks: `/auth/doors` lists the
providers that have ids and whether mail is set up, `/auth/start` refuses an
unconfigured one in our own words, and the page draws only what it is told.
Filling in `GITHUB_CLIENT_ID` later makes the button appear with no change to
the site. The copy names no provider either, or three names over one button
reads as two of them having failed.

**Unreachable is not "none", and saying so is what unblocks the ordering.**
`doorsOffered` answers `null` for a service it cannot reach at all and the
page names the host and says nothing is wrong with your account — so the meta
tags can go on BEFORE the record propagates, instead of the old rule of
holding them back. A 404 is an older deployment, which is a working one for
whatever it has: every door is kept.

**FOUR pages carry the tag, not the three the runbook said for months.**
`account/index.html` is the page a sign-in LANDS on, so without it the round
trip completed and arrived somewhere that said membership was not open.

**SIGNING OUT MUST REACH THE SERVICE THAT SIGNED YOU IN.** The session is an
httpOnly cookie only its issuer can clear; the sign-out button is in the nav
of all twenty-three pages and four name a service — so the common case
cleared the display claim and left the session standing for the rest of the
week: signed out to look at, a member to the service. The display claim
carries `iss` for it, checked as a URL (https, no path, no credentials, no
query) and never looked up, because a display claim is a copy anybody can
rewrite. The pin that asserted `iss` was absent was re-argued, not deleted.

**Verify the provider's side by DRIVING IT, with a control.** Fetching
Google's authorize URL with the real client id and redirect URI renders the
consent page; the same with a callback path that is not registered renders
`redirect_uri_mismatch` and "Access blocked". The clean result means nothing
without the control — that pair is what proves the Google console is right
before DNS exists.

Three states were measured in the browser against a stub served from the
site's own origin (`auth/doors`, CSP `'self'`): one provider offered and the
rest hidden, no providers at all folding to the not-ready panel, and the real
unreachable host naming itself. The KV holds both owner records, good to
2036; `geoid-data-gate` is NOT deployed, so the bucket pass is not yet needed
and the four baked grids are open.
