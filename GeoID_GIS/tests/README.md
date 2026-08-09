# Tests

Two commands, no dependencies to install — plain Node and Python, the same as
the rest of the tooling here.

## Unit tests — the analysis is correct

```bash
node GeoID_GIS/tests/run.mjs
```

Runs every `*.test.mjs` under `viewer/` and aggregates them. These check the
maths the product's credibility rests on against answers known independently:
`dsp.js` against planted signals, `stats.js` against SciPy's own outputs,
`postprocess.js` against hand-worked DOF interpolation. Exit 0 when green.

Add a test by dropping a `*.test.mjs` anywhere under `viewer/`; the runner finds
it with no registration. A test file is a standalone script that prints
`PASS`/`FAIL` lines and exits non-zero on failure.

## Smoke test — every page still mounts

```bash
python3 GeoID_GIS/tests/smoke.py
```

Boots the real site in headless Chrome and walks all 64 Research pages,
asserting each mounts without throwing or coming up as a "failed to open" stub.
The Hub is a page registry, which is exactly the shape that lets a page rot
silently — a broken import fails no build (there is no build) and none of the
other pages. This is the test that catches "a page went blank" before a user
does.

It serves the repo itself, launches whatever Chrome/Chromium is on the machine
with `--headless`, and drives it over the DevTools protocol through a
stdlib-only WebSocket client — no puppeteer, no chromium download. If no browser
is found it prints a note and exits 0 (set `GEOID_CHROME` to point at one).

## In CI

```bash
node GeoID_GIS/tests/run.mjs && python3 GeoID_GIS/tests/smoke.py
```

The unit tests are fast and need nothing; the smoke test needs a Chrome on the
runner.
