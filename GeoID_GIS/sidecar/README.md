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

## Meshing: gmsh, or Blender

The Model Studio meshes in the sidecar with **gmsh** by default (`POST
/jobs/gmsh`). **Blender** is the interchangeable second mesher: pick it per
model under **Mesh ▸ Mesher**, use **Export ▸ Mesh with Blender**, or ask Atlas
("build a volcano with a chamber and mesh it in Blender"; a connected model
can call the `blender_mesh` tool with a list of shapes).

`POST /jobs/blender` runs the studio's bpy script (`viewer/gis/studio-blender.js`)
through `blender_mesher.py`: Blender builds the solids with exact booleans
(and an optional voxel remesh), then gmsh fills the closed surfaces with
tetrahedra. The mesh lands at `meshes/<name>.msh`, flagged like gmsh's (top 3,
base 2, sides 5, chamber wall 7, volumes 10+), so FEM Setup and GALES read it
unchanged. A layered halfspace is one block here; use gmsh for its layers.

What to install:

- **Blender 4.2 LTS or newer** with `blender` on PATH (blender.org, or
  `sudo snap install blender --classic`), or `GEOID_BLENDER=/path/to/blender`.
  It runs headless (`--background --factory-startup`).
- **or a live Blender** with the [blender-mcp](https://github.com/ahujasid/blender-mcp)
  addon: install `addon.py`, press **Connect** in its sidebar tab, and the
  sidecar sends the script to that Blender's socket (127.0.0.1:9876, or
  `BLENDER_HOST`/`BLENDER_PORT`, the same variables its MCP server reads), so
  you see the model built. With `via: "auto"` (the default) an open Blender
  wins over the binary.
- **gmsh's Python module** for the volume fill: `pip install gmsh`.

`GET /capabilities` reports `blender: {binary, mcp, gmsh}`, and the studio says
which is missing instead of failing. Tested by `python3 GeoID_GIS/tests/sidecar_blender.py`
(fake Blender and fake MCP socket; a real gmsh fill where the module is installed).
