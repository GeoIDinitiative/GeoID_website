# Site shell and header: GeoHUB names, mode bar, header, nav, journal, music, service worker

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## The myGeoID disclaimer is armed by myGeoID, not by the page

The gate in `geohub/index.html` ran on EVERY LOAD and held the whole shell
inert until acknowledged — which is why it had been switched off in
development (`DEMO_DISCLAIMER_GATE = false`, the modal `.remove()`d). Both
states were wrong: on, it stood in front of Earth exploration, the Model
Builder and the Research Hub, none of which show a synthetic hazard value;
off, the page went on presenting myGeoID's made-up numbers as though they
were readings, which is the one thing the gate exists to say out loud.

It is scoped to its subject now, and the trigger is exact rather than
approximate. **myGeoID IS "the GIS page with the hub armed"** — mode-manager's
own `armed = currentMode === "gis" && hubArmed` — and the viewer already
reports precisely that to the shell as mode `"geoid"` over the postMessage
bridge. So arming raises the gate and nothing else does. (Worth checking
before trusting: `"geoid"` looks like it might conflate the myGeoID MODE with
"GIS + hub armed", and it does not — they are the same state.)

- **Acknowledged once per SESSION** (`sessionStorage`), not per arming: a
  modal that returns on every toggle is a nag, and one that never returns
  after a restart makes a claim about somebody's memory that a disclaimer
  should not make. A storage that throws (private window) asks again rather
  than failing open.
- **"Leave myGeoID" is the second door.** A gate whose only action is Continue
  is a notice wearing a gate's clothes. It stands the mode down through
  `setHubArmed` — the same seam the Enter button uses — via a `message`
  listener in mode-manager, so declining cannot leave the mode running behind
  a dismissed warning.
- **`.demo-disclaimer-backdrop` is `display: flex`, which outranks the `hidden`
  attribute**, so `[hidden]` is spelled out with `!important`. Without it the
  modal shows on every load — exactly the behaviour being removed.

Verified live end to end: nothing on load (page live, `pointer-events: auto`);
arming raises it with the rest of the shell inert and Continue disabled until
the box is ticked; Cancel closes it, leaves the key unset AND disarms the
mode; Accept closes it, keeps the mode armed, and re-arming does not ask
again this session.
## The music player, and the tracks that were not there

`music.js` (one copy per viewer, ten of them) shuffles a playlist and
plays it. Two tracks — Andromeda.mp3 and infinity.mp3, 9.1 MB and 6.9 MB
— were deleted from `assets/music/` in a size cleanup on 25 Aug 2026
while every viewer went on listing them. Because the playlist is
SHUFFLED, whenever it started on one of the dead entries the audio
element errored, `ended` never fired (an error is not an end), and the
button sat there doing nothing: reported simply as "music player is
broken", and intermittent by construction. The dead entries are gone from
all ten modules, and an `error` listener now ADVANCES to the next track —
with a consecutive-failure count so a playlist where everything fails
stops rather than spinning. Verified by wrapping `window.Audio` to catch
the element the module creates: Nebula (1).mp3 loads, plays, clock
advancing, no error. Note the paths differ by viewer on purpose: Earth's
copy uses `/assets/music/...` (absolute) and the planet copies
`../../../assets/music/...`, because a planet page is three directories
deep.

### A frame is the state of the ice, not the outlines filed that day

"Why do the polygon fills jump around from frame to frame?" — because each
frame drew only the outlines SUBMITTED on its own date, and the archive is a
record of submissions rather than a census. Measured on the Valais box: **410
outlines filed on 2003-08-13 against 8 on 2018-09-01**, 26 distinct dates. So
whole glaciers appeared and vanished every step, and what moved between frames
was which analyst had been working, not the ice.

The ghost layer did not answer it and could not: it is `outlineOnly: true`, so
it holds no FILL — it marks where the glaciers are and leaves the areas
blinking.

`stateAsOf` carries each glacier's latest outline forward, so a frame says what
the ice WAS on that date: a glacier nobody remapped keeps the outline it had,
which is exactly what a reader means by "then". Nothing is invented — every
polygon drawn is a real outline with a real date, and the frame only ever holds
outlines at or before its own.

- **The invariant is that the drawn count NEVER FALLS.** A falling count is a
  glacier blinking out, which is the whole fault, and it is invisible in a
  still frame. Pinned in the suite alongside "nothing is drawn before it was
  filed".
- **One palette across every frame.** The last epoch used to be drawn in its
  own colour so the sequence "read forwards" — which, once the geometry stopped
  jumping, was the remaining jump: the whole map changed colour on the final
  step. Brightness marks what was REMAPPED on this date instead, which is the
  new information and is constant in meaning across frames.
- **The bar says both numbers**, because they are two different facts: "620
  glaciers · 8 remapped on this date". The second explains the first.
- **Built once, in order, with a cursor** that never walks back — a step is
  then a visibility flip, and the sequence costs one pass over the archive
  rather than one per frame.

### The outlines say what their colour measures, and they switch off

Two reports on one screenshot, and the second is the more interesting.

**A toggle, and it is ONE STATE SEEN THREE TIMES.** The outlines are a layer,
so a control already existed as its eye in Workspace — but a reader watching a
sequence is looking at the bar, and a reader setting one up is looking at the
panel. So there are three faces and one state: the panel's **Glacier outlines**
tick, the bar's `◇`, and the layer's eye. Every one of them commits through
`GeoIDLayerHierarchy.setVisible` and reads its state back off the layer rather
than remembering what was last pressed — the panel and the bar both re-sync on
`geoid-gis:layers-changed`. Verified in all three directions: pressing any one
moves the other two. The bar's button is offered only where a driver supplies
frames, so the imagery animator gets no button for an overlay it does not have.

**"None — outlines only" made one control answer two questions**, which is why
it had to go: turning the imagery off was the only way to say anything about
the polygons, and there was no way to say it at all while imagery was on. The
dropdown says only what it draws now (`None — no imagery` survives, because
watching outlines over the basemap with no request spent is a real mode), and
the tick box beneath it owns the outlines. They are BUILT either way and hidden
when unticked: building is the slow half and costs the same fetch, so hiding
rather than skipping is what makes all three faces instant. Somebody who wants
no outlines at all wants Basemaps · Imagery over time, which draws none by
construction.

**"The colouring adds nothing as there's no unit of measurement on the
legend."** Exactly right. The frames were painted bright for "remapped on this
date" and pale for "carried forward" — two hues with no scale, which says only
"these are different", and the dates in the bar had already said it. Worse, the
layer carried no `legendInfo` at all, so the dock drew its stand-in: a gradient
bar over the row "66 polygons", which is this file's own documented tell for a
legend that does not exist.

Both colourings are now a MEASUREMENT with a unit, stated in the legend, and
chosen before the sequence is built (the colours are baked into each frame's
vertices, so a control on the bar would silently re-triangulate 24 frames):

- **Outline age, in years** — how old the outline being drawn is at this
  frame's date. The default, because it is defined for every polygon in every
  frame, and it is the honest reading of a carried-forward map: where the
  colour darkens, the archive has not looked recently and the ice may have
  moved without the map moving.
- **Area change since first mapped, in per cent** — the subject itself, on a
  DIVERGING scale because zero means something here: a sequential ramp puts
  "lost a fifth" and "gained a fifth" at two ends of one scale with no mark
  where the ice held its ground. Loss warm, gain cool, the convention every
  published glacier-change map uses.
- **One colour**, for reading extent alone.

Three things that make the change map honest rather than merely coloured:

- **The baseline is the EARLIEST outline, not the first one returned.** The
  archive answers in whatever order the server holds submissions.
- **A glacier the archive holds ONCE is left in the no-value grey**, with a row
  of its own. Measured against itself it would come out "within 5% of its first
  outline" — which says the ice held its ground where nothing was measured at
  all. On the Valais box that is 163,884 of 668,000 drawn vertices.
- **The classes are fixed across the whole sequence**, so a colour means the
  same thing in frame 1 and frame 24. A legend recomputed per frame makes the
  map about the frame rather than about the ice.

**The layer is named for what its colour measures** — "Glacier time-lapse —
area change since first mapped (%)" — because the legend card's heading is the
layer's name, and a key of six blues under "Glacier time-lapse" leaves the unit
nowhere to be said. The GHOST gets a row too: it is drawn in every frame, and a
thin outline nothing explains reads as a fault in the map.

**And the feature list now follows the frame.** `featuresAt` walks
`layer.features`, which was left on the whole fetch — so a click on a glacier
answered with whichever of its outlines came first in the array, an 1850 one
under a 2016 frame, with a card that was right about the archive and wrong
about what was on screen. The player calls the driver back on every step, and
the driver points `features`/`collection` at that frame's set. Measured: 181
features over 1 date at frame 0, 488 over 37 dates at frame 23.

Verified live on the Valais box: the age map draws in exactly the six classes
its legend names (read back off the vertex colours, converted linear→sRGB),
frame 0 entirely "surveyed on this date" and frame 12 spanning all six; the
change map draws all seven of its classes; the legend card renders seven or
eight swatched rows with no ramp, where it used to read "66 polygons".
## The website header: the explorers live under About

Earth Explorer and Planet Explorer left the top row of the header for the
About menu, after myGeoID App, on all 18 pages that carry the header. It is
copied into each page, so a header change is 18 edits. An explorer page keeps
its own entry's `active` mark inside the menu, and `scripts/site.js` then
lights the About toggle, as it already does for the About pages. The About
section's page-jump bar is a separate copy of the same list, on About,
myGeoID App, Our Team, Get Involved and Updates, and it takes the two
explorers in the same place. It was missed the first time and reported from a
screenshot. The Data and Researchers bars are those sections' own and do not
list the About pages. The footers are unchanged.
## The website header: one solid action, and an underline that moves nothing

`styles/site-nav.css` is loaded last on every page with the header, so the
header is fixed THERE and nowhere else. Measured before changing it: on the
page whose link is active, that link was **38 px tall against its neighbours'
32**. The active underline was a `display: block` `::after` with a top margin,
which added height and lifted the label 3 px off the row. The underline is
absolutely positioned inside the padding now. **The dropdown toggle's
`::after` is its CARET** (shared.css), so an `::after` underline rule wiped
the About caret. Its underline is a background gradient instead, and the
`::after` rule excludes `.nav-dropdown-toggle`.

**Membership and Donate were identical solid magenta boxes**, which made a
way in and a gift look like equal calls to action:
- Membership (`nav-act-signin`) is now the only solid action on the bar.
- Donate is outlined and carries a ♥.
- A signed-in member (`nav-act-member`) gets quiet ink with a cyan status dot.

`skins/synthwave.css` paints `.nav-act-donate` as a solid neon button with
`!important`, so the outline had to say `!important` too. Specificity alone
lost, and the computed background read magenta until it did.

The About section's `.page-jump` sub-nav was teal rounded pills in a
different face. It now uses the header's face, inks and underline active
mark. The phone grid in shared.css is untouched. `sw.js` STATIC_CACHE was
bumped to v43, because site-nav.css is precached.
## The Journal replaced the legacy updates page

`/updates/` was 2,044 lines of legacy "about" CSS around eight cards. It is now
the **Journal**: `updates/index.html` (the membership page's template) plus
`scripts/journal.js`, reading two files.
- **Posts and technical notes** come from `data/journal.json`. A body is
  structured blocks — `["h"|"p"|"eq", text]` or `["ul", [{lead?, text}]]` —
  rendered through `textContent`, so a hand-edited file cannot inject markup.
- **Releases** come from `data/updates.json`, the file `make-updates.py`
  builds the homepage grid from, so a release is announced in one place.

- **An entry has an address**: `/updates/?p=<slug>` is pushed onto history, and
  back returns to the list with its filter and search intact. `?p=` on an
  unknown slug is replaced with the list rather than left as an empty reader.
- **Technical notes are GeoID's own method write-ups**, marked "Not peer
  reviewed", with references (real, published) and Copy citation / Copy BibTeX
  (`@techreport`; a reviewed entry sets `peer_reviewed`, `venue`, `doi` and
  becomes `@article`).
- **The four posts come from `posts.txt`**, with two access lines corrected to
  the current terms (every Explorer is free) and an `edited` note saying so.
  Their dates are inferred from the git history of the features they announce;
  edit them in the JSON.
- The pure half (`citationText`, `bibtex`, `sortEntries`, `matches`,
  `readingMinutes`) imports without a DOM.
- "Journal" was added after Get Involved in every About dropdown and About
  sub-nav (22 files, by script). The homepage button reads "The Journal".
## Google Docs and Sheets windows belong to the hub, not to a page

`gis/research/gdoc-windows.js`: floating windows that frame Google files. The
Docs & Sheets page had a single frame inside itself, so a doc could not sit
beside the page it described. The shell row's **Docs** button
(`#research-act-docs`, in `index.html` and `gis/shell.html`) opens a launcher:
- paste a link
- the project's attached documents (`metadata/links.json`)
- recently opened documents
- New Doc / New Sheet
- tile the open windows

Every window can drag, resize, snap to a half, minimise to a dock, maximise,
switch edit/preview, reload and open in a tab. Windows are appended to
`#research-hub`, so they survive page changes and hide with the hub. State is
one array in localStorage (`geoid-research:gdoc-windows`), restored at install.
The seam is `window.GeoIDDocWindows`, and the Docs page's rows gained
**Window** and **Pop out** buttons.

- **A frame eats the pointer.** A drag across another window's cross-origin
  frame is lost as soon as the pointer enters it. Every frame is inert while
  `body.gdoc-busy` is set, and the gesture holds pointer capture on its handle.
- **The shell row is two lines tall** (79 px at 1400 wide). A constant 56 px
  top put snapped windows over the Docs button itself, so the top edge is
  measured from `.workspace-shell` (`topGap()`).
- **Never serialise a DOM node into saved state.** The first `save()` dropped
  `node` and `frame` but kept `modeBtn`.
- Verified with Google's public sample Sheet, which is fully editable in the
  frame. A nonexistent Doc id renders Google's own "file does not exist" page,
  which also proves the frame loads.
## The brand image became a WORDMARK, and a wide image cannot fill a square slot

The logo gained the name, so `assets/GeoID_logo_icon.png` went from 493x475 to
715x230 -- 3.4:1 where every slot on the site had been built for 1:1. What that
breaks is not obvious, because nothing errors:

- **`.nav-brand-icon` was pinned square** at 36px (shared.css) and 30px
  (site-nav.css), with `min-` and `max-` on both axes. `object-fit: contain`
  keeps the aspect and spends the rest of the box on nothing, so the lockup
  would have drawn **36px wide and 11px tall** -- legible as neither a globe
  nor a word. It is height-driven now and the width follows.
- **A THIRD copy of that rule is inlined in `index.html`'s own `<style>`**, and
  being later in the document it won on equal specificity. The computed height
  read 30px while both stylesheets said 34. When a rule is right in the sheet
  and wrong in the browser, enumerate the rules that MATCH the element --
  `sh.cssRules` filtered by selector -- rather than re-reading the file.
- **54 of the references are favicons and ~25 more are square badges** (the
  viewer's corner logo, the Atlas rail, the ecosystem and sitemap diagram
  nodes, a hero watermark, a THREE texture). A 3.4:1 favicon is a sliver. Those
  point at `assets/GeoID_mark.png` -- the globe cut out of the lockup's own
  first ink run (x 8..213), squared with a 10% margin -- so the mark is the
  user's artwork rather than a substitute.

**What stays on the lockup is every slot that was already `width: auto`**: the
23 headers, the 12 footer brands (`height: 40px`), the About hero, and one
inline `height:32px`. The rule that sorted them is the CSS, not the markup:
height-driven takes the lockup, square or width-driven takes the mark.

**`grep -h` STRIPS THE FILENAME, so a `| grep -v page_backups` after it filters
nothing.** A survey built that way counted 43 header instances where there are
24, and would have had me editing the backups. Use `-n` without `-h` when the
next pipe stage filters by path.

The visible `GeoID Initiative` beside the header logo is gone, since the image
says it. The link's `aria-label` STAYS: the img carries `alt=""`, so without it
the link would announce as nothing.
## The mode bar: move the ROW, not the pills

"The folder, GIS, Model, Research and music buttons should be the same style
and position across all 3 pages." They were three different rows, and two of
them were missing half the controls.

`parkModeSwitch` moved `#view-mode-switch` alone into the Model ribbon or the
Research shell row. Everything ELSE in `.brand-toprow` -- the project folder
and `#music-btn` -- stayed behind in a sidebar those pages cover, so Model and
Research had no way to open a project and no player at all. Measured, the
pills then came out three different ways, because each host restyled them:

| | display | gap | font | padding | pill |
| --- | --- | --- | --- | --- | --- |
| GIS | flex | 5.6px | 10.56px | 4.8 / 9.6 | 76x25 |
| Model | flex | 3.2px | 9.92px | 4.16 / 8.8 | 36x23 |
| Research | **grid** | 8px | 10.88px | 6.4 / 4.8 | 71x29 |

**`parkModeRow` moves `.brand-toprow` ITSELF.** Same element, same class, same
children in the same order, so every rule written for the GIS header still
matches and the three pages are identical BY CONSTRUCTION rather than by three
sets of numbers kept in step by hand. `is-parked` drops only what is sidebar
chrome -- the divider, the margins -- and hides `#nav-collapse-btn`, which
folds a panel that is not on screen.

Two things that bite:

- **`#music-btn` IS `position: fixed` BY DEFAULT.** It only becomes an inline
  button through `.brand-toprow-actions #music-btn`. So it can never be
  appended to a slot on its own -- moved out of that container it springs back
  to floating over the page. Moving the whole row keeps it where its rule can
  find it.
- **`body.studio-open #music-btn { display: none !important }`** hides the
  floating player in Model mode, which is right on the planets, where the
  floating one is the only one there is. Parked, the button is part of the row
  and has to survive that, so a more specific `!important` restores it.

**A pill that sizes to content is not the same pill.** Parked, the switcher
came out at 39px a button against the sidebar's 76, because the sidebar gives
it `flex: 1` of a 24rem panel. It is given that width outright (`15rem`) and
divides it the same way. Measured after: 75-76px in all three modes, with
font, padding and gap equal to the digit.

The four `.view-mode-switch.is-in-studio` rules are gone from both
stylesheets. A test pinned one of them; its INTENT (a row of pills in the bar,
not a stacked tile) still holds, so it was re-argued against the new mechanism
rather than deleted.
## The event card shimmered on a globe that was not moving

"The pop-up moves side to side even when the view is static and rotation is
paused." Measured on a paused globe with the camera still: the card's `left`
travelled **3.2 px, sixty times a second, for as long as it was open**.

The chain is four links and every one of them is doing its job:

1. the seismicity and the volcano clouds BREATHE -- `material.size` swings by
   `PULSE_SIZE` (16%) each frame. Measured live: 26.69 to 30.96 px.
2. `applyHaloScale` sizes the selection ring from a marker, through
   `markerSpriteFor`, which read `node.material.size` -- the DRAWN one.
3. `dotOnScreen` reports `reach` as half the ring.
4. `trackPopup` places the card at `dot.x + reach + gap`, every frame.

So the pulse reached the card's left edge. **The ring's own comment already
said it may not breathe** -- "it can only stay on the circumference if it
stays that size" -- and its pulse loop is careful to vary opacity alone. What
defeated that was the value it was sized FROM.

The cloud now records `userData.steadySize`, the size it would be without the
breath, beside the one it is drawn at, and anything MEASURING a marker reads
that. Measured after: drawn size still swings 4.27 px, steady size and ring
size spread **0.00**, card `left` spread **0**.

Two things about verifying it:

- **RE-INJECTING THIS FAULT BY DELETING `steadySize` PROVES NOTHING.** The
  size loop runs every frame and writes it straight back, so the A/B came back
  clean against a fault that was never restored. What measures it instead is
  computing the left edge the pulsing reach WOULD have produced, from the two
  sizes sampled in the same frame.
- **The spin runs at 15 degrees an HOUR in real time.** Resuming it and
  watching for 6 s moved the globe 0.0004 rad and the card not at all, which
  reads as tracking being broken by the fix. `setTimeRate("lapse")` is what
  exercises it: measured 55 px of travel while turning, 0 px paused either
  side of it.

`trackPopup` also writes whole pixels and only when they change, so no future
sub-pixel source can put the card back on the style-recalculation path every
frame. The two other placement paths clear that record, or a frame that
computed the same number would skip a write it needed.

### And the Model bar had to stop centring before the row could line up

Moving the row made the three pages agree on FORMAT; it did not make them
agree on where the row starts. Measured, `.brand-toprow` left edge:

    GIS 31    MODEL 150    RESEARCH 106

Two things put Model 119px right of GIS, and removing either alone makes it
worse rather than better:

- **`<span class="studio-brand">Meshing Studio</span>`** led the ribbon, 103px
  of it, pushing everything after it along. It is gone from both shells.
- **`#model-studio .studio-ribbon` was `justify-content: center`.** With the
  brand removed and the run still centred, the leftover width is shared out
  and the row lands somewhere else again -- further right, not further left.
  `flex-start` is what makes the ribbon's own padding decide, and the padding
  is set to what the sidebar puts in front of its own copy.

`.studio-topbar` also moved from `left: 0.9rem` to `1rem`, which is the inset
`#ui` and `.studio-dock-left` both already use. Measured after: **Model 31,
GIS 31, offset 0.**

**Research stays at 106 and that is structural, not an oversight.** The hub's
left rail owns the first 96px -- `.workspace-shell` starts at 96 and its
actions row at 106 -- and the rail's top is where the hub puts its own mark.
Putting the row at 31 there would lay it over that. Aligning it means moving
the rail, which is a change to the hub's header rather than to this row.

### And then the row had to be the sidebar's WIDTH, or it divides differently

Starting at the same x is not the same as landing at the same x. Measured
after the ribbon was left-aligned, every button after the first was still 2-4px
adrift and the row itself 34px short:

| | row | folder | GIS | Model | Research | music |
| --- | --- | --- | --- | --- | --- | --- |
| GIS | **356** | 31 | 68 | 150 | 232 | 319 |
| Model | **322** | 31 | 68 | 148 | 229 | 315 |

Three things, and each is the parked copy overriding a sidebar rule it did not
have to:

- **`width: max-content`.** The GIS row is the sidebar's CONTENT WIDTH, which
  falls out of `#ui` being `min(24rem, 100vw - 2rem)` less 0.85rem + 0.75rem of
  padding and two 1px borders -- 356.4px, derived rather than measured, so the
  two agree at every viewport rather than at the one they were tuned on.
- **`gap: 0.45rem` against the sidebar's `0.5rem`**, which is the whole of the
  2-4px drift: 0.8px a gap, compounding along the row.
- **`#view-mode-switch { flex: 0 0 auto; width: 15rem }`.** That was written
  when the parked row sized to its content and the pills came out at 39px. Given
  the right width and the right gap, the SIDEBAR'S OWN `flex: 1` divides it into
  the same three 76px pills without being told a number.

**A hidden control is still part of what `space-between` divides.**
`#nav-collapse-btn` folds the globe sidebar, which is not the page on screen, so
it was `display: none` -- and removing it from the LAYOUT hands its 24px and its
gap to the music button, which then sits 30px right of where the GIS page draws
it. `visibility: hidden` keeps its place and gives up only its ink.

Measured after, Model against GIS: **row 356 = 356**, folder, GIS, Model and
Research at **0px** of offset, music at 1px (the calc's own 356.4 rounding).
The ribbon was already two rows tall before this, so the extra 34px cost it
nothing -- checked by putting the old rules back inline and re-measuring, rather
than assumed.

The `y` still differs by design: 33 on GIS, 20 on Model. The GIS row sits
INSIDE the sidebar panel, below its top edge; the studio's bar is the topmost
thing on its page. Matching it would push the ribbon down and take the deck
below it along, since the deck is placed from `--studio-chrome-h`.
## The mode bar is the SHELL'S HEADER's, and what crosses the frame is a press

The row was re-parented into whichever page was on screen — the GIS sidebar,
the Model ribbon, the Research shell row — so its position was three other
layouts' business. Two could be brought into line (31, 33 and 31, 20); the
third could not, because the Research hub's rail owns the first 96px of its own
layout and the row sat at 106 there. **A bar that moves is a bar that cannot be
anchored**, and three rounds of chasing it is what says to stop moving it.

It lives in the site header now, between the wordmark and the links, where
`.nav-context` already sits. Measured across all three modes: **left 415 in
every one**, and it does not move when the mode changes.

**A NODE BELONGS TO ONE DOCUMENT.** The header is in the shell
(`geohub/index.html`, `position: fixed`, 72px, with the iframe starting at
y=72); the row is in the viewer. So the header cannot hold the row and draws
its own buttons — and that is a second set of controls, which is exactly the
drift this file records for the clip button, the extraction dialog and the
click sound. What keeps it from being a second implementation is that **only a
PRESS and a STATE cross the frame**:

| | |
| --- | --- |
| `geoid:modebar-press` | the shell → the viewer, which **clicks the real control** |
| `geoid:modebar` | the viewer → the shell, read off those controls' own DOM |
| `geoid:modebar-host` | the shell saying it has the bar, which is what hides the row |

So a locked mode still refuses (a disabled control is left alone), the project
dialog still opens its own way, and the player still runs its own playlist
error handling. `mode-bar-bridge.js` holds no copy of any of it, and the shell
holds no `setMode`, no storage and no audio — pinned in both directions.

**The state is READ, never remembered.** The mode is changed by a key, by a
link and by the studio standing a locked mode down; a bar that remembered its
own presses would report a mode the page had left. `modeBarState` reads
`body.dataset.viewMode` and the music button's own `is-paused` class, and a
control the page does not have is not offered at all rather than drawn greyed —
which is what keeps the nine planet pages honest.

**TWO PAGES MUST KEEP THEIR OWN ROW, and one of them is a width.** The viewer
opened standalone and the nine planet viewers load no site header at all
(measured: zero occurrences of `site-nav.css` in either), so the row is
**hidden by a class the shell sets** rather than removed — a page with no shell
has nothing to get wrong. And the header has no room on a phone, so the
stylesheet drops the bar below 680px; the claim is conditional on that same
width (`matchMedia`, re-claimed on `change`) or a narrow screen would have no
mode switch anywhere — hidden in the header AND hidden in the viewer because
this side said it had one. Verified live at 600px: the header's bar `display:
none`, the viewer's row back at 31, and the handover crossing both ways with no
reload.

Hidden by a CLASS with `!important`, never the `hidden` attribute: the row is a
flex item in three hosts and every one of them sets `display`, which outranks
the attribute — the trap this tree has paid for five times. `parkModeRow` goes
on moving the hidden row between the slots, because the standalone page needs
that and a second rule about when to park is a second rule to get wrong; the
empty slots are hidden so their host's `gap` does not spend a step on them.

**The bar speaks the HEADER's language**, not the app's: the nav's own ink, its
uppercase body face at its own tracking, and its accent filling the open mode
in dark ink, which is how this header already says "you are here". The viewer's
sidebar look would read as a panel that had escaped its page, which is what it
was. The three pills share **one width, 88px — the widest of them measured**,
so the group cannot resize on a press and walk the bar sideways.

`GeoID_GIS/index.html` is a superseded second copy of this shell (`rel=canonical`
to `/`, nothing links to it). It does not claim the bar, so a viewer
framed there keeps its own row — correct by construction rather than by a case.

**site-nav.css is PRECACHED by the service worker**, so an edit to it needs
`STATIC_CACHE` bumped in `sw.js` or returning visitors keep the old sheet.

### Nestled against the logo, and the tab headers may not move

"Move these buttons closer to left" then "ie the tab headers shouldn't have
been moved — must always be positioned centrally". Both halves measured before
either was touched, and the second one is the interesting half.

**The wordmark grew.** `.nav-wordmark` is `flex: 1 1 0` and so is the
membership group at the other end — **that pair is what centres `.nav-links`** —
so the anchor stretched to 542px around a 106px image and the bar began
458px right of the logo's ink.

**AND A BAR IN THAT LINE IS WEIGHT ON ONE SIDE OF THE BALANCE.** Measured with
the bar removed from the DOM entirely, the links land **dead centre, 0px off**.
With it in the line they were **194px off**; handing the wordmark's growth to
the bar improved it to 69 and did not fix it, because the fault is not how the
slack is shared — it is that there is anything there at all.

| | links off centre |
| --- | --- |
| no bar in the DOM | **0** |
| bar in the line, wordmark growing | 194 |
| bar in the line, bar growing | 69 |
| links centred on the BAR | **0** |

So the two are separated rather than balanced: the links are centred on the
viewport (`position: absolute; left: 50%; translateX(-50%)`) instead of by
whatever happens to sit either side of them, and the wordmark stops growing so
the buttons sit 32px from the logo — the header's own gap, with no margin of
the bar's own on top of it. Nothing added to this header can shift them again.

**BELOW 1400px THE TWO CANNOT BOTH BE HAD, and that is arithmetic.** The logo
and the bar together reach 518px and a centred 360px link block starts at half
the width less 180, so they meet at about 1396. Under it the header hands the
bar back to the page — where it lived before, and a perfectly good place for
it — and the shell watches the same width, or such a screen would have no mode
switch anywhere at all. Verified at 1300: the header's bar `display: none`, the
row back at 31, and the links still 0px off centre.

**Scoped four ways, each a case where the header must be exactly as it was**:
`:has` for the twenty-one content pages that share this header and have no bar,
`:not([hidden])` for a shell whose viewer has not answered yet, and the two
widths. Verified on `/about/`: wordmark still `1 1 0`, links still `static`,
still 0px off centre. A browser without `:has` drops the rule and gets the
header it always had, which is the right way to fail.

**A measurement that "proves" a layout is unaffected can be measuring its own
rule.** The first check hid the bar with `display: none` and read the links at
162 — because `:has(.nav-modebar:not([hidden]))` still matched an element that
was merely not drawn, so the wordmark was still held at `0 0 auto`. Remove the
NODE for a baseline, not its paint.

### `.brand-toprow` IS NOT ONE ELEMENT, and a class-wide hide took four panels' ✕

Reported as the major windows losing their close icons, with the Settings
window as the example. Measured: **five `.brand-toprow` elements on the page**,
and `body.modebar-hosted .brand-toprow { display: none !important }` — written
an hour earlier to hide the mode row once the header took it over — hid every
one of them.

| row's parent | what it is |
| --- | --- |
| `#ui` | the mode row, the one that should be hidden |
| `gis-side-panel-preprocess` | **Geoprocessing**'s head |
| `gis-side-panel-analysis` | **Analysis**'s head |
| `gis-side-panel-export` | **Export**'s head |
| `gis-side-panel-settings` | **Settings**'s head |

The workbench panels **ARE the sidebar** — `adoptSidebarShell` reads `#ui`'s
own computed style rather than imitating it, which is the note this file
already records — so each one heads itself with a `.brand-toprow` carrying its
title, its collapse `‹` and its close `✕`. Hiding the class hid all four heads,
and with them the only way to close those panels with the mouse.

**The mark goes on the ROW, and the row is found by the switch it holds.**
Neither the class nor document order identifies it: the class is on five
elements, and `parkModeRow` moves this one between three hosts.
`getElementById("view-mode-switch").closest(".brand-toprow")` is true wherever
it has been parked. `.brand-toprow.is-modebar-hosted` is the rule now, and the
test pins that the body-scoped form is gone as well as that the new one is
there.

**The symptom was invisible to every property the buttons carry.** The ✕ read
`display: flex`, `visibility: visible` and its own `✕` as text — because it was
the PARENT that was hidden, and a child of a `display: none` box still reports
its own computed display. What said so was the BOX: 0×0 at 0,0. When a control
is present, styled and not on screen, measure its rect and then walk up.

Verified after, on all four panels: the head `display: flex`, the `‹` and `✕`
at 25×25, `elementFromPoint` at the ✕'s centre returning the button itself (the
hit test the geology card's own ✕ already cost a round), the close closing and
the collapse collapsing. A sweep of every other dialog, modal and floating
window on the page found none missing a closer.

**AND THE ROW IS NOT ONLY THE MODE BAR.** Hiding it whole then took
`#nav-collapse-btn` with it — the control that folds the sidebar into the
margin — because that button is one of the row's four children, not a thing of
the mode bar's. Measured at 0x0 with the same signature as the panels' ✕: its
own `display: block` and `visibility: visible`, a parent that was gone.

Only the three controls the header now draws are hidden — the folder, the
switch and the player — and with three of four children gone the row's own
`space-between` would have put the collapse at the LEFT, so it takes
`justify-content: flex-end` and the button stays where it has always been.
Measured after: 363, 33 at 24x25, hit-testable, folding the panel to -384 and
reopening from the edge tab. The Model deck's own fold was never affected
(24x22 throughout); the row holds exactly four children, so there was nothing
else to lose.

Verified framed on a PLANET as well as on Earth, which also exercises the
re-claim on navigation: pointing the frame at Mars gives the same hosted row,
the same collapse at 363, 33 and the header bar with GIS active.

### The LIVE pill, the collapse, and a world's own recording

Four placements settled by report, and the last one is the interesting one.

**The LIVE pill sits beside the CLOCK.** It sets the rate the clock counts at,
and the two were a panel apart — the pill in the sidebar's title row, the clock
in the fixed top cluster. It is in that cluster now, 7px right of the clock,
which also means it stays put when the panel is folded away. Earth only:
`#time-rate-toggle` exists on no other viewer.

**The collapse takes its place**, beside the info button in the title row. It
had been left alone in the row above, which is the mode bar and is drawn in the
shell's header — and the nine planet viewers headed that same row with their
info button and their collapse, so all ten now have one shape: the page's own
controls with the page's own title, and the row purely the bar.

**A row with nothing of its own left goes entirely**, and which rows those are
is COUNTED rather than listed: `rowIsOnlyModeBar` asks whether every control in
the row is one the header draws. A list would have said "Earth" yesterday and
"all ten" today, kept in step by hand.

**THE MUSIC PLAYER AND A WORLD'S RECORDING ARE TWO SOURCES WITH TWO CREDITS.**
A planet viewer carries both — the app's playlist (`#music-btn`, `position:
fixed` by default, floating over the globe) and "Sounds of Mars - NASA InSight"
(`#audio-play-btn` with its own caption). Reported as a duplicate music player,
and it was: the header drew a music button while the page's own floated beside
it. Both page-side players stand down while the header draws them, and the
header draws them in two different places, because they are two different
things — the playlist in the mode bar on the left where it always was, the
world's recording on the RIGHT of the banner between the links and the
membership group, where the page's own things go.

- **The recording's own caption becomes the button's name** (`Play — Sounds of
  Mars - NASA InSight`), so the credit travels with the control rather than
  being left behind in a sidebar block that is now hidden.
- **Each says it is playing in its own way** — a class on the music button, a
  swapped icon on the recording — so the bridge reads each in its own terms.
  Reporting one as the other is how two controls come to mean one thing.
- **A world with no recording reports none**, and the right-hand button stays
  hidden rather than falling back to the music, which would put the same player
  in two places on Earth.

**THE TAIL OF BOTH STYLESHEETS IS PINNED EQUAL from the studio block onwards**,
so anything appended to one must be appended to the other — and anything that is
NOT the studio's belongs above that marker. The planets' `.brand` rules went to
the end of `shell.css` and failed that check; they sit before it now, which is
also where they belong by subject.

### The Map tab on the other nine worlds, and a footer Earth had always hidden

"The GIS tools are not the same as Earth's." Measured rather than eyed: Earth
reads Live Events · Explorer · **Map** · Geology · Earth Observation · Hazards ·
Model Builder · Metadata; Mars read Explorer · Geology · Sea Level · Model
Builder · Metadata. Three of the missing tabs are Earth-only DATA SERVICES
(EONET, the Earth Engine share, Earth hazards) and are dropped by the body
registry on purpose. **Map was not** — every world dresses a sphere.

**The section existed on all nine and was nested two levels down**, inside
Explorer, because the planet viewers were written by hand long before this tab
bar existed. Each is a `control-section` in its own right; most simply had no
id, which is the only reason the shared promotion could not see it. Naming it
`basemap-section` is the whole change — one MOVES entry and one TAB_ORDER
entry, a no-op on whichever world lacks the id, so Earth's
`basemap-relief-section` and the planets' `basemap-section` are one list
serving two markups and no world can end up with two Map tabs.

**A TITLE LIVES IN AS MANY PLACES AS THERE ARE SURFACES THAT SHOW IT**, and
this one had a second. The four gas giants rewrite the heading at runtime —
`titleLabel.textContent = "Basemap"` in each viewer's own `configureUi`,
because a gas giant has no relief — so the markup rename was overwritten and
the tab still read "Basemap" while the file said "Map". Seven files carry that
line (each gas-giant folder keeps a stale `saturn-viewer.js` beside its own,
the documented self-contained-copy trap). The no-relief nuance stays where it
belongs: the summary copy under the heading already says "Body texture and
derived atmosphere layers".

**And the copyright in the middle of the column was a rule Earth had and the
planets did not.** `body[data-view-mode="gis"] #ui-scroll-body > .status` lives
in Earth's own stylesheet; the planets read `gis/shell.css` and never had it, so
their viewer footer sat between the tabs and the Workspace box. Ported — as a
DESCENDANT rather than a child, because Earth's status is a direct child of the
scroller while the gas giants' markup nests one level differently and lands it
under `#ui`. Measured on Jupiter: parent `#ui`, still shown under the `>` form.
One selector for both placements beats restructuring nine hand-written files.

**Two measurement traps, both mine.** A `</div>`-counting heuristic said the
status was inside the scroller on every world; the DOM said `#ui` on four of
them — ask the parsed tree, not the bytes. And a live DOM that disagrees with
the served bytes is not always a cache: here `fetch` returned the new markup
while the frame showed the old title, and the difference was a script rewriting
it at runtime. Check for a runtime writer before clearing caches.

Verified on all ten: every world now reads **Map** in Earth's own position, with
no footer in the column — Mars, Moon, Mercury, Venus and Pluto at six tabs,
Jupiter, Saturn, Uranus and Neptune at four (no geology, no sea level), Earth at
eight.

### The rail: the tools were all there, and three of them were offered twice

"The GIS tools have not been copied from the Earth viewer." Measured, they had
been — and the difference was the opposite of missing.

| | Earth | Mars |
| --- | --- | --- |
| rail items in the page | 7 | 7, same icons byte for byte |
| Geoprocessing sections | 17 | **17, identical** |
| Analysis sections | 10 | 8 |
| rail items SHOWN | **4** | **6** |

The two Analysis sections Earth has alone are "People here (WorldPop)" and
"Seismograms (FDSN)" — Earth data services, correctly absent elsewhere. The
47-tool registry, the batch runner and the history are the same list on both.

**What differed is that the planets showed three tools the rail no longer
owns.** Earth's markup carries `hidden` on the Distance and Profile rail items,
with the reason beside it: they live on the DRAW BAR now, where everything else
the pointer does over the globe already is. Verified on both — the bar carries
Points, Distance and Profile beside the shapes, so on a planet the rail was a
second doorway to each of them. The buttons stay in the page either way,
because the bar reads their `is-active` to know which tool is armed and clicks
them to arm one.

**Hidden on the five ROCKY worlds only.** A gas giant builds no draw bar — it
has no `setStudyAreaPolygon` and nothing to draw on — so there the rail is the
ONLY doorway to Distance and Profile, and both work perfectly there. Hiding
them would have taken away two working tools to tidy a bar that does not exist.
Verified: Jupiter still shows Distance and Profile with Draw disabled and its
own reason on the button; Mars now shows Draw, Geoprocessing, Analysis and
Search at a rail height of 170 — Earth's own.

**When a report says something is missing, measure what is SHOWN against what
is PRESENT.** Everything here was present on every world; the fault was four
items visible on one and six on another, which reads as the richer one being
right.

### The Workspace ⓘ on the planets: present all along, and saying nothing

Asked to ensure the planet viewers have it. Measured first: they do. On Mars,
Jupiter and standalone Venus every Workspace row carries
`.gis-catalogue-info-btn`, 16×16, styled (the `installStyle()` in
`datasetInfoButton` doing its job), hit-testable, and opening its card — an
imported layer's and the basemap's alike.

**Two of my own probes said otherwise and both were the probe.** The first
looked for a card by class when the element is `#gis-catalogue-info-pop` by id.
The second clicked the same button a second time and read the TOGGLE as a
failure to open. A card that reports `hidden: true` with the right content
already in it has been opened and closed, not never opened.

**What was genuinely wrong is what the card SAID.** On every planet it read
`Basemap: <body> basemap` over one row, `Kind: shipped texture`, and nothing
else — where Earth's names the imagery and states its licence.

`activeBasemap()` reads `viewer.getBaseLayerId()` and looks the option and the
manifest entry up by it. **That function is on EARTH'S SEAM ALONE** (measured
on Mars: `typeof` is `"undefined"`), so the id came back empty, no option
matched, no manifest entry was found, and everything downstream fell back. The
select already knew — `#base-layer-select` is what earth-viewer, basemap-drape
and this file all read as the authority for which texture is on — so it is the
fallback now. No new seam, no per-viewer port, and Earth untouched because its
seam answers first.

**And the row then had to be redrawn when that answer arrives.** The dock's
700 ms poll had `getBaseLayerId()` in its signature, which on a planet is `""`
for ever — so neither the select becoming readable nor the reader switching
texture ever changed it, and the row sat on the fallback name until something
else happened to redraw. The select's value is in the signature, and the
`change` listener is DELEGATED on the document because the planet viewers build
their panels after this module runs, so one bound to the node bound to nothing.

Measured after: Mars reads **"Basemap: Mars Color Map - Viking"** with
*"USGS Viking global color mosaic basemap."* on its card, follows the dropdown
to "TES Albedo" and back, and Earth is unchanged at "Basemap: Sentinel-2
Cloudless" with its CC BY-NC-SA licence.

**The credits for the planets' other textures are NOT invented.** What the card
shows comes from each world's own manifest entry; where a texture's manifest
carries no `attribution`, the card says what it can and no more. Filling those
in means sourcing each mission's attribution, which is content to be confirmed
rather than guessed — the rule this file already states for a
licence-conditional dataset.

### The player is claimed on its OWN width, and the bar's rule was hiding it

Reported with a screenshot of Mars's deck still carrying "Sounds of Mars — NASA
InSight" beside the title. At full width it was already gone; **at 1300px it was
not**, and worse — measured there, the header's button was showing AND the
deck's player was back, which is the duplicate the whole arrangement exists to
remove.

**One claim was doing two jobs.** `modebar-hosted` is gated at 1400px, the
width below which the logo and a 356px bar would reach the centred tab headers.
The player is one 30px button tucked against the membership group and reaches
for nothing — the only width that matters to it is the 680px at which the
stylesheet hides it. Tied to the bar's rule it stood down at 1399 while the
header went on drawing it.

So there are two claims: `hosted` for the row's three controls at 1400, and
`audio` for the world's recording at 680. The shell watches both media queries
and re-claims on either.

**AND THE REPORT WAS GATED ON THE BAR ALONE.** With the split in and the bar
stood down, `report()` returned early, the header was never told there was a
recording to draw, the deck had already hidden its own player, and the player
was reachable from nowhere — measured at 1300 as `hidden: true` on a button
whose title was still the default "Play". Either claim is reason to report now.

Measured after, on Mars: at 1556 the bar hosted, the deck clear, the player at
1277–1307 between Contact and Membership; at 1300 the bar handed back to the
page (its own row and floating playlist returning, as designed) with the deck
still clear and the player at 1021–1051, between Contact and Membership there
too.

**A width rule written for one control will be inherited by the next one added
beside it.** Ask what the new control's own constraint is before reusing the
gate that happens to be there.

### And the credit is READ, not hovered for

The button was a bare glyph with "Sounds of Mars - NASA InSight" on its
tooltip. That name is the whole reason the control carries the PAGE's word for
it rather than the app's, and a credit that exists only on hover is one most
readers never see. It is a caption beside the glyph now, read off the page's
own `.brand-audio p`, so what the deck used to say is said where the control
is.

**THE GLYPH HAS TO BE ITS OWN ELEMENT, and the alternative fails silently.**
`btn.textContent = "⏸"` on a press replaces every child — so the first
time anybody played anything the caption would be gone and the button would
come back a bare glyph, with nothing anywhere to say why. The renderer writes
the glyph's own span and falls back to `textContent` only where that span is
absent (a page whose markup predates this).

**THE CAPTION GOES BEFORE THE CONTROL DOES.** Measured between the centred
links and the membership group: **357px of slot at full width against 229 at
1300**, with the credit itself 179px over 29 characters. So the caption is
dropped at 1399 — the width the bar already hands itself back at — and the
player stays as the 30px glyph it was. Losing the whole control there would
take the recording with it; losing the caption costs a tooltip. The 32ch cap
is a guard against a caption nobody has written yet, not something this one
reaches.

Measured after, on Mars: at 1556 the button 1082–1307 with the credit
unclipped between Contact and Membership, a press starting the recording with
the glyph flipping ▶→⏸ and the caption standing; at 1300 the caption
`display: none`, the button 1021–1051, still between them. On Earth, which
carries no recording, the button stays absent and the bar stays hosted.
## The hub's quick-access header becomes a rail in the right margin

The shell row had grown into a second navigation — a page filter, the project
chip and six word buttons — in a shape this app uses nowhere else. The four
that act on the workspace are a column of icon buttons down the right margin
now, at the GIS tool rail's own measurements, keeping `shell-action` and their
`data-drawer` so `wireActions` finds them exactly as it found the words.

- **The mark and the FIRST band's label go.** The GeoID logo is in the banner
  directly above that column. A band header separates one group from the one
  above it; at the top there is nothing above, so it sat where a title would.
  The rest stay.
- **One line, one reserve.** Tabs and actions each took a full-width row —
  right for a wall of words, and with one chip left the second row held a chip
  and a rule. The column reserves the corner once, from the length the Atlas
  mark publishes; the row had been reserving it again on top.

**A DOORWAY IS A DOORWAY; THE FEATURE IS NOT ONE OF ITS DOORS.** Two of the
removals were the only way to something real:

- **Atlas** held the model-subscription form — the only place a Claude,
  ChatGPT or Gemini key can be set. It opens from Settings now.
- **Docs** was the window launcher's anchor, and `install()` RETURNED EARLY
  without it: removing the button would have stopped `restoreSaved()` and never
  published `GeoIDDocWindows`, taking the Docs & Sheets page's own Window and
  Pop out buttons with it. The launcher opens from that page's header — on the
  HEADER rather than in the document pane, which returns early when nothing is
  linked and the first thing the launcher offers is somewhere to paste a link.

**A POPOVER PINNED TO A CORNER IS PINNED TO THAT CORNER.** The launcher set its
RIGHT edge from its anchor's right edge, exact while the only anchor was at the
far end of the shell row; from a button on the left of a page header the same
arithmetic put it at **left -177** of a 384-wide panel — open, correct, and off
the screen. Appended, measured, then placed under its anchor's left edge and
clamped at both ends. Its pressed state is cleared on the button that OPENED
it, not on an id no longer in the markup.

**`guard()` short-circuits a project-scoped page**, so a probe with no project
open finds none of that page's controls and reads as a button that failed to
render. Open a project before measuring one.

### And nothing may grow into the centred links

My own regression, from centring the tab headers on the viewport. **Out of
flow, the links stopped being PUSHED and started being DRAWN UNDER**: measured
with a project open, the header's project label ran 568..660 against links
beginning at 598 — **62px of overlap**, the name drawn through "Dashboard". It
survived every check because that label is empty until a project is opened.

**THE LABEL IS GONE FROM THIS HEADER ALTOGETHER.** It was moved to the
right-hand group first (between the hosted bar at 518 and the links at 598
there are 30px, and a project's name is not 30px) — and then removed, because
with the hub's own chip and the Projects page it was the THIRD copy of one
string on one screen. The viewer still sends `geoid:context`; the header has
no consumer for it. What remains is the rule below, which now holds only the
recording's caption back.

**THE CAP ALONE IS WORSE THAN NEITHER.** A `max-width` shrinks the box and
leaves it ANCHORED WHERE THE FLOW PUT IT — measured, the group went
550..1532 → **550..1116** and drew its whole contents across the links rather
than shrinking. `margin-left: auto` takes the free space before `flex-grow`
can, so the box sits against the right edge and the cap then makes the two
shrinkable things in it — the label and the recording's caption — ellipsise.
Both are needed, and the ORDER OF THE FREE-SPACE RULES is why.

Measured at 1556 while the label still existed, with a 47-character name and a
caption both in the row: group 974..1532, 16px clear, the label clipped to
100px, no overlap. The cap stays for the caption, which can be 32ch.

**`store.listProjects()` answers `<body>/<name>` entries and `openProject`
takes one of those** — passing `p.dir || p.name` opened a project called
"undefined" and left a folder tree under that name in browser storage. There is
no `deleteProject` on the store, so test projects made this way can only be
cleared with the site's data.
## A world loads only what it OFFERS

Earth's plate boundaries were drawn on Mars at launch — 241 segments of Bird
(2003) over a planet that has none, loaded **twice**, one of them still wearing
its `.geojson` filename.

**The catalogue was right throughout.** That row is offered nowhere on Mars and
none of its hosts exists there. The launch defaults reached past the offer by
asking for the dataset **by id**, and the gate meant to stop them asked the
wrong question in the wrong place: *"does this page have any catalogue at
all"*, evaluated at `DOMContentLoaded`. **`panels.js` renders ONE MARKUP STRING
for all ten worlds**, so every host is in the DOM at that moment and every world
passed; the body registry prunes them a moment later.

The question is per dataset and asked at load time now — does this world offer
this one — and the PANEL answers it, because "is its home's list mounted here"
is the panel's business and not `global-data.js`'s. Anything given a
`defaultOn` later is gated by the same question without being told about it. A
second guard skips a dataset already on the globe, which is what killed the
duplicate.

Measured: Mars 2 → **0**, Jupiter and the Moon 0, Earth **1** with its name
tidied. **Earth keeping one is the control** — without it the fix is a switch
turned off.
## The explorer pages carry the About bar, and it wears the header's type

Earth Explorer had no bar; Planet Explorer had the styles and no markup. Two
mistakes getting there, both worth keeping:

- **`.page-wrap` carries `min-height: 100vh`**, so the bar's first container
  took the whole viewport and pushed the hero **843px below the fold**. Its own
  container mirrors `.page` instead.
- **`.fs-hero { height: auto }` overrides `.explorer-hero`**, so the real sizer
  on that page is `.fs-panel`'s `min-height` — subtracting the bar anywhere
  else reached nothing, and the hero still overflowed by 48px.

The bar's height is one number (`--explorer-jump-h`), measured at 43px plus its
20px gap.

**THE SUB-BAR IS A CHILD OF THE HEADER, so it wears the header's type.** The
family already matched; the size, the case and the tracking did not — the
shared base was 11.2px at 0.07em against the header's 12px at 0.08em, close
enough to read as a mistake rather than a choice. Aligned in `shared.css` and
in the six pages that override it, so a reader moving between About pages sees
one bar rather than two looks.

**Match what a page COMPUTES, not what its source says.** `/team/`'s own rule
names `"Public Sans"` and the cascade overrides it with `"GeoID Nav Body"` —
copying the source would have reproduced a declaration that does not win.
## The mobile drawer, and why `site-nav.css` has a media query now

The hamburger failed on **every page of the site** at phone width, and the
script was never the problem: the click landed, `is-open` went on, and
`.nav-links` computed `display: flex` at 167px tall. The header stayed 62px.

`shared.css` had the mobile case right — `height: auto`, `min-height:
var(--nav-h)`, `flex-wrap: wrap`, `overflow-y: auto` — and **`site-nav.css`
loads after it and sets `height: var(--nav-h)` at the same specificity with no
media query at all**. The drawer opened inside a box that could not grow and
was clipped by that box's own `overflow-y: auto`, taking the hamburger out of
the visible strip with it: a menu that opens invisibly and cannot be dismissed.

The override lives in `site-nav.css`, beside the rule it corrects, so the two
files cannot drift apart again. Two further rules came from the measurement
rather than the reading: with the header wrapping, the toggle fell to top 420
**under** 167px of links and 102px of actions, so the links and the sign-in row
are ordered after it and the toggle takes the top row's free space.
## `/about_myGeoID/` is now `/about_geohub/`, and the old path must keep forwarding

The page's subject changed — GeoHUB is what it is about, and the hazard model
is one section of it (`#how`) rather than the whole page. The old URL is in the
wild, so `about_myGeoID/index.html` stays as a redirect stub: `rel=canonical`
at the new URL, `noindex, follow`, a meta refresh and a `location.replace`.
**Do not delete it**, and do not point new links at it.

The rename touched the About dropdown and the About sub-bar in 22 pages. A
blanket `>myGeoID App<` → `>GeoHUB<` sweep is too broad: it also caught an
`<h3>` on `/about/` whose card body describes the Factor-of-Safety tracker, not
the workspace. That heading is restored and the card points at
`/about_geohub/#how`. The rest of the site still frames myGeoID as its own
thing, deliberately — the rewrite was scoped to the one page.

**Anchors are part of the rename.** `#geohub` on the old page became `#modes`
on the new one, and `researchers/index.html` linked straight at it.
## A warm launch is warm now: one root service worker, and a start-up screen that waits

"Even with the loading screen, not all layers are loaded — five to ten seconds
to fully load." Two faults, and the first is why no cache ever helped.

**TWO WORKERS AT ONE SCOPE, EACH DELETING THE OTHER'S CACHES.** The site nav
registered `/sw.js` and the Earth viewer registered `/sw-ctx-tiles.js`, both at
scope `/`. A registration with a different script URL REPLACES the worker, so
every GeoHUB load swapped them — and Cache Storage is ORIGIN-WIDE, while each
worker's activate deleted every `geoid-*` cache that was not its own version.
The tile worker also re-downloaded ~50 planet textures on each install. The
net effect was a cache wiped on every visit. The planets' and flight sim's own
workers (scopes `/planet_explorer/`, `/flight_sim/`) had the same blanket
delete and would wipe the root caches whenever they activated.

- **`/sw.js` is the only root worker.** Both Earth viewers register it; the
  root `/sw-ctx-tiles.js` is a one-line `importScripts('/sw.js')` for pages
  cached from before. The CTX proxy and ArcGIS tile handling moved into it.
- **Activate deletes only old versions of its own families**
  (`geoid-site-`, `-data-`, `-basemap-tiles-`, `-remote-`, `-root-`) plus the
  two legacy names. The planet and flight workers got families of their own
  (`geoid-planets-*`, `geoid-flight-*`) and the same rule.
- **What is cached:** fingerprinted bucket data (`?v=`) cache-first — rivers,
  borders, places, tile pyramids; the Sentinel-2 / GIBS / OSM tiles
  cache-first (trimmed at 4,000); the plate boundaries and GEM faults from
  GitHub stale-while-revalidate (GitHub sends max-age=300); STAMPED code
  (stamp.py's `v=YYYYMMDD-sha7`) cache-first, because a stamped URL never
  changes content — two hundred modules that used to be refetched every visit
  with `cache:'reload'`. Unstamped code stays network-first (epoch-stamped
  planet modules do not move, so they are excluded by the pattern), and on
  localhost stamped code stays network-first too, because an uncommitted edit
  re-stamps to the same value. Range requests (COG reads) are never cached.
- **The finished opening mosaic is cached whole** (`geoid-mosaic-v1`, written
  by basemap-drape.js from the page, never touched by the worker): the
  reprojected 4096×2048 Sentinel-2 image as one WebP, 30 days, only when at
  least 97% of its tiles drew. A warm launch paints one image instead of
  fetching, decoding, compositing and reprojecting 256 tiles.

**THE START-UP SCREEN HANDED OVER ON ONE TEXTURED FRAME**, and then the
mosaic, the plates, the rivers and three thousand names arrived in front of
the reader. `gis/launch-ready.js` is a list of holds: the opening basemap, the
catalogue's launch defaults, the place names and the first round of live feeds
each hold while they load, and the shell's `ready()` waits until none are
held. Every hold times out by itself (9–15 s) and the shell's 16 s CAP still
stands. Also: the launch defaults load in PARALLEL (they were awaited one
after another), and the gazetteer's fetch starts when its module loads rather
than when the viewer is ready.

**Country borders are a launch default** at 20% — the LINES
(`boundaries-10m`), not the country polygons, which at 20% would tint the
whole planet. A homeless dataset is offered by the Map tab's Overlays list,
so the launch-default gate asks for `#polygon-catalogue` when an entry has no
home (before, a homeless `defaultOn` would never have loaded).

Measured on the headless software renderer, warm: at hand-over the mosaic,
plates, borders, rivers, all 2,903 place names and the live events are already
on the globe; the holds settle at ~7 s (viewer boot is ~4.6 s of it there),
where before the names alone landed at 10.6 s AFTER the screen had gone.

## One GUI on macOS, Linux and Windows

There is no size conversion to remove: the GUI is already in fixed pixels (panel
384 px, root 16 px) and measures the same at 1440 and 1920. What differed:

- **A width, not an OS.** The mode bar left the header below 1600, so every
  MacBook (1440-1512 wide) and a 1920 laptop at 125% got another layout. Between
  1360 and 1599 the links now give up the centre and follow the bar
  (`site-nav.css`); only below 1360 does the bar go back to the panel. The width
  lives in `site-nav.css` and in `index.html`'s `claimModeBar`: change both.
- **Type.** `-webkit-font-smoothing`, `font-synthesis: none` and text-size-adjust
  in `shared.css` and `viewer-skin.css`, because macOS thickens text by default.
- **Scrollbars.** Overlay on macOS, so panels were 8-10 px wider there and text
  wrapped differently. A drawn 10 px bar everywhere; Chrome ignores
  `::-webkit-scrollbar` while `scrollbar-width` is set, hence the reset.
- **Controls.** Checkboxes, sliders and dropdowns are drawn (`viewer-skin.css`).
  A checkbox clips its overflow: toggles that hide the box by size would
  otherwise leave the tick floating.

Monospace readouts still use each OS's own face, and a screen's physical size
still changes how much of the 384 px panel fits above the fold.

