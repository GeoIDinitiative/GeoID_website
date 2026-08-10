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

## Atlas — the assistant

The **◆** button in the bottom-right corner of every page. Atlas knows this
workspace and reads your open project, so with no setup at all it can:

- find a tool — *"where do I import data?"*, *"open signal processing"*
- say where the project stands — *"status"* — and what is missing
- suggest the next step — *"what should I do next?"* — and explain what is
  blocking one — *"why can't I get results?"*
- check the live feeds around your study area — *"anything happening nearby?"*
- keep watching them — *"watch this area"*, *"watch status"*, *"stop watching"*

Every answer comes with the button that performs it.

**Watching** runs in the sidecar when one is connected, so it continues with
every tab closed and tells you what it found when you come back. The first pass
only records what is already out there; after that you hear about new events at
or above M4, and Severe/Extreme weather alerts, inside your study area.

**Your own model (optional).** For open-ended questions, plug in a Claude,
ChatGPT or Gemini subscription in the **Atlas** drawer at the top of the Research
Hub. The key is held by your local sidecar at file mode `0600` — never by the web
page, because a browser cannot keep a secret — and only a masked hint is ever
shown. Without a key Atlas answers from the app and its project and says plainly
when a question is beyond that.

## Running a simulation somewhere bigger

A solve outgrows a laptop quickly, so **FEM ▸ Run ▸ "Where it runs"** lets you
pick the machine:

- **This machine** — `mpirun -n <ranks> gales <deck>` locally.
- **A server** — add one with its host, SSH user and rank count (a Hetzner box,
  a lab workstation, a cluster login node). The deck is sent over with `rsync`,
  solved there, and the results come back into the same run folder, so
  Post Processing and the analysis pages are unchanged.

Access is by **SSH key only**. Run this once and the app uses your key:

```bash
ssh-copy-id user@your-server
```

Passwords are refused by design — an unattended solve cannot answer a prompt,
and the sidecar will not hold one. Press **Test** on a target to check it is
reachable and that `mpirun` and `gales` are actually there.

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
node GeoID_GIS/tests/run.mjs \
  && python3 GeoID_GIS/tests/sidecar.py \
  && python3 GeoID_GIS/tests/smoke.py
```
