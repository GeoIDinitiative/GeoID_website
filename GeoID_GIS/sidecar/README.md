# GeoID sidecar

The Research Hub is a static site, so its heavy verbs — running a training
script, running an external script or one of its functions, listing and stopping
jobs — have no interpreter to execute in. This is that interpreter: a small,
stdlib-only HTTP service that runs beside a `geoid_projects` folder.

## Run it

```bash
python3 GeoID_GIS/sidecar/geoid_sidecar.py --root ~/geoid_projects
```

Point `--root` at the folder that holds (or will hold) `geoid_projects` — the
same folder the desktop app and the browser's folder-picker use. It prints a
line like:

```
http://127.0.0.1:8137?token=…
```

Paste that whole line into the hub under **Settings ▸ Local Sidecar** and press
**Connect**. From then on the hub reads and writes that folder through the
sidecar, and Run Training Script / Run Script Main / Run Function start real
subprocesses whose output streams into the page's log.

## What it does and does not do

- Binds **127.0.0.1 only** — never reachable off this machine. CORS is limited
  to localhost origins.
- `/fs/*` is confined under the projects root; `..` cannot escape it.
- A **token** (printed at startup, sent as a Bearer header) gates every call but
  `/health`. Pass `--no-token` to drop it on a single-user machine.
- Script execution is intentionally **not** sandboxed — running *your* scripts
  is the whole point — but only ever on an explicit request from the hub.

Nothing here is required to use the hub. Without the sidecar the hub behaves
exactly as it did before: the run buttons say to start it, and the browser's own
storage backs the project. The sidecar is opt-in and local.
