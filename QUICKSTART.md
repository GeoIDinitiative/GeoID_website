# GeoID — quick start

Everything here runs on **standard-library Python and a browser**. Nothing to
install, no build step, no npm.

## Run it

```bash
python3 serve.py
```

Then open the URL it prints — **http://localhost:8125/myGeoID/**.

That one command starts:

- the **site** (the planet viewers, the GIS globe, the Research Hub), and
- the **sidecar**, the local helper that runs real work for the Hub.

To connect the sidecar (do this once): copy the line the sidecar prints on
startup and paste it into the Hub under **Research ▸ Settings ▸ Sidecar**. From
then on, projects are real folders on disk that the desktop app can also open,
and the FEM stage can run GALES.

Use `localhost`, not `0.0.0.0` — the project folder picker needs a secure
context, and `0.0.0.0` is not one.

Options: `python3 serve.py --help` (`--port`, `--projects`, `--no-sidecar`,
`--no-token`).

## What runs where

| part | what it is | needs |
| --- | --- | --- |
| the site | static files — viewers, GIS, Research Hub | just a browser |
| the sidecar | `GeoID_GIS/sidecar/geoid_sidecar.py` — runs GALES, scripts, and owns the project folder | Python 3 (stdlib) |
| GALES | the native FEM solver | installed separately, on `PATH` as `gales` (with `mpirun`) |

The site works without the sidecar — projects are kept in the browser and the
solver/script buttons explain what to start. The sidecar is what turns the
viewer into a workbench.

## Develop

After editing anything under `GeoID_GIS/viewer/`, restamp the cache-busting
query so the browser fetches the new modules:

```bash
python3 GeoID_GIS/services/stamp.py
```

Before shipping, run the tests (see `GeoID_GIS/tests/README.md`):

```bash
node GeoID_GIS/tests/run.mjs && python3 GeoID_GIS/tests/smoke.py
```
