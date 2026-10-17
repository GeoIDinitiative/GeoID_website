# The GeoHUB Atlas agent (NOT the Atlas AI app in ~/atlas-ai)

Working notes moved verbatim from GeoID_GIS/CLAUDE.md (2026-10-17), in their
original order. The index is GeoID_GIS/CLAUDE.md; ask the code graph first
(see there) and read the section here that it points you at.

## Atlas — the assistant

`gis/atlas-assistant.js` puts a fixed launcher bottom-right on **every** page
(Earth's index lists it as a script tag; the planet pages get it from `boot.js`'s
MODULES). It loads its own CSS, so adding it to a page is one tag.

**It is grounded, not mocked, and that is the whole design.** `ECOSYSTEM`
describes the workflow once — each link's `produces`, `needs`, `has(state)`,
`act` — and `probe()` reads the live truth across all three modes (project,
study area, datasets, meshes, runs, built decks, results, series, analysis,
figures, globe layers, sidecar, compute targets). Every answer is derived from
those two: `nextStep()` is the first unmet link whose prerequisites are met,
`blockers()` walks the chain for "why can't I…". So it cannot invent a page, it
is always about *this* project right now, and **adding a capability is a row in
that table, not a new branch.** Each answer carries the button that performs it.

A model is optional and additive. With an Atlas hub configured
(`GeoIDAtlas.connect(url)`), anything the grounded layer cannot answer goes to
its `POST /api/chat/simple` with `{messages, context}` — the shape that endpoint
documents for exactly this ("the Research Hub's project/page/selection"). It has
its own reflex layer, so trivial intents never reach a model there either.
Without a hub Atlas says what it can and cannot do rather than improvising.

**Page search must be intent-weighted or it lies confidently.** Matching the
question's words against page *blurbs* made "**where** do I do meshing?" return
Metadata & Lineage, whose blurb begins "**Where** every file came from" — the
grammar outvoted the subject. So: strip interrogatives/auxiliaries (`STOPWORDS`,
deliberately excluding real page words like run/data/mesh), light-stem
(`meshing`→`mesh`), score a **name** hit 5× a blurb hit, and require ≥3 — a
floor only a name match clears. That floor is what makes "I don't know" possible
at all; without it an unanswerable question matched some blurb and got a
confident wrong answer.

`window.GeoIDAtlas.notify(message, actions)` is the seam the watcher pushes
hazard alerts through.

### The watcher

`gis/atlas-watch.js` polls the connectors on a timer against the study area.
Driven conversationally — "watch this area", "watch every 5 minutes", "watch
status", "stop watching". Three rules decide everything, each because the naive
version is actively harmful, and **all three fail silently**, so
`atlas-watch.test.mjs` pins them (16 checks):

1. **The first pass never announces**, it records a baseline. Measured on the
   live feeds: a global area baselines **2,209 events** — without this rule that
   is 2,209 alerts on open, and the user stops reading them, which is worse than
   no monitoring at all.
2. **Only new events announce**, keyed by a stable id (a USGS event url, an
   EONET id) and persisted to `metadata/atlas_watch.json`, so a reload does not
   re-announce the same eruption. The seen-set is trimmed to 500 per feed.
3. **New is not significant**: a magnitude floor (M4) and a severity floor
   (Severe/Extreme). A feed of every M0.5 tremor is noise wearing the clothes of
   information.

`triage()` is pure — no clock, network or storage — which is what makes those
rules testable rather than hoped for; the polling around it is the only impure
part, and one unreachable feed never stops the others.

**A narrower intent must be checked before a broader one.** "watch status" was
swallowed by the generic `status` branch and answered with the *project* status;
that branch now excludes watch/monitor. Any new intent sharing a keyword needs
the same care.

### The watcher in the sidecar, and your own model key

`sidecar/atlas_watch.py` is the same three rules where they can run **with every
tab closed**. `atlas-assistant.js` prefers it whenever the sidecar is connected
and falls back to the in-page watcher otherwise; `drainAlerts()` catches the
browser up on what it missed, keyed by a cursor in localStorage. State persists
to `.atlas_watch.json` beside the projects, so a sidecar restart does not
re-announce.

**Bring your own subscription** — Claude, ChatGPT or Gemini — following Atlas
AI's own procedure (`hub/secrets_config.py`), deliberately mirrored so the two
agree: an allowlist of key names, a JSON file outside git at **mode 0600**, and
status masked to `••••••last4`. The key is set *into the sidecar* and stays
there: never written to the page, never returned, never logged. That is why
`/atlas/chat` exists at all — **a browser cannot hold a secret**, so the call
that needs one is made on that side.

**The bbox must be applied per feed or the promise is a lie.** Only USGS takes a
bbox parameter; NWS and EONET are global. Unfiltered, "watching your study area"
was really watching 300 global wildfires and 122 nationwide alerts, so the study
area is now applied in `_nws`/`_eonet` against each event's own geometry
(`_first_point` reduces any geometry to a placeable point, and an alert with no
geometry cannot be placed, so it is not claimed to be nearby). Measured to prove
it narrows rather than silently dropping everything: western US 30 quakes / 1
alert / 155 fires against 416 / 121 / 300 worldwide.

**The Earth page's script tag needs its own `?v=`.** `atlas-assistant.js` was
added unstamped, so it imported an *unstamped* `sidecar.js` — a second module
instance with its own connection state, and Atlas insisted the sidecar was not
connected while the hub was talking to it happily. Exactly the module-identity
trap above: `stamp.py` only rewrites stamps that already exist, so a new tag must
be given one by hand once.
## The Atlas verification ledger: forecasts checked against what happened

`atlas-ledger.js` (pure, 47 checks) and `atlas-ledger-page.js` (the page
half). The total-risk card dispatches `geoid-gis:total-risk-computed`; every
reading with a `VERIFY` entry becomes a record (hazard, place, the window it
is about, lead, score). Once the window has passed it is verified:

- **Weather** against Open-Meteo: the ERA5 archive once the window is six
  days old, the model analysis before it (marked provisional and replaced
  later). CAPE is not in ERA5, so it is always read from the analysis and is
  final. **Archived and recent records at one place are asked in SEPARATE
  requests**: in one request the newest record decides the endpoint, and an
  old record was read provisionally from the analysis.
- **Events** against NASA EONET over each place's own box and window, and
  aftershocks against the USGS catalogue (M ≥ 5). EONET is curated, so an
  absence is a weak negative, and the report says so.

What it learns: a contingency table, Brier skill against climatology, a
cross-validated logistic calibration (needs 20 verified records), and for
the weather the error distribution and its least-squares correction. It is
kept in `localStorage["geoid-gis:atlas-ledger"]` and copied into an open
project at `metadata/atlas_ledger.json`. It is shown in Hazards ▸ myGeoID ▸
"How well the models have done". Atlas answers verification questions
through the registry's `verification` tool. Verified headless with all three
services mocked.
