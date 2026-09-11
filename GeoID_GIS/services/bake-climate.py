#!/usr/bin/env python3
"""
Bake the near-surface climate normals the TEMP and PRESSURE readouts read.

    python3 GeoID_GIS/services/bake-climate.py

Writes `data/global/climate-normals.json`: NASA POWER's MERRA-2 climatology
(2001-2020) of 2 m air temperature and surface pressure, annual means, on
MERRA-2's own 0.5 x 0.625 degree grid — together with the ELEVATION of each
grid cell, which is what lets the page downscale a cell's mean to the ground
under the cursor (a lapse rate for temperature, the hypsometric equation for
pressure). Without the grid's own height the downscaling has nothing to be
relative to, and a mountain inside a 55 km cell would read the cell's mean.

WHY POWER, and why not the others, stated where somebody will look:

  - ERA5 is the better reanalysis and needs a Copernicus CDS key; a browser
    cannot hold one and a bake should not need one.
  - WorldClim is finer on land and does not permit redistribution.
  - NCEP/NCAR's long-term means are keyless and public domain, at 1.9 degrees.
  - POWER is NASA's own service over MERRA-2, keyless, free of restriction,
    and it answers a 10 x 10 degree box per request with every cell's elevation
    on it. The Zarr copies on AWS answer 403, so the API is the door.

One parameter per request (the API refuses two), 648 boxes a parameter, one
request at a time: about twenty minutes, all of it waiting on the network.
"""
from __future__ import annotations

import json
import math
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "global" / "climate-normals.json"
WORK = ROOT / "data" / "global" / ".climate-work"

API = ("https://power.larc.nasa.gov/api/temporal/climatology/regional"
       "?parameters={param}&community=RE&format=JSON"
       "&longitude-min={w}&longitude-max={e}&latitude-min={s}&latitude-max={n}")

# MERRA-2's grid, as POWER serves it. Longitudes are multiples of 0.625 from
# -180, latitudes of 0.5 from -90, poles included.
DLON, DLAT = 0.625, 0.5
WIDTH = int(round(360 / DLON))          # 576; 180 and -180 are one column
HEIGHT = int(round(180 / DLAT)) + 1     # 361, both poles

PARAMS = ("T2M", "PS")


def fetch(param: str, w: int, s: int) -> dict:
    """One 10-degree box, cached on disk so an interrupted bake resumes."""
    WORK.mkdir(parents=True, exist_ok=True)
    cache = WORK / f"{param}_{w}_{s}.json"
    if cache.exists() and cache.stat().st_size > 100:
        return json.loads(cache.read_text())
    url = API.format(param=param, w=w, e=w + 10, s=s, n=s + 10)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                body = r.read()
            data = json.loads(body)
            if not data.get("features"):
                raise ValueError(json.dumps(data)[:300])
            cache.write_bytes(body)
            return data
        except (urllib.error.URLError, ValueError, TimeoutError) as error:
            if attempt == 5:
                sys.exit(f"{param} box {w},{s} failed: {error}")
            time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def cell(lon: float, lat: float) -> tuple[int, int]:
    i = int(round((lon + 180) / DLON)) % WIDTH
    j = int(round((lat + 90) / DLAT))
    return i, j


def main() -> int:
    size = WIDTH * HEIGHT
    grids = {p: [math.nan] * size for p in PARAMS}
    elev = [math.nan] * size
    boxes = [(w, s) for s in range(-90, 90, 10) for w in range(-180, 180, 10)]
    for param in PARAMS:
        start = time.time()
        for k, (w, s) in enumerate(boxes):
            data = fetch(param, w, s)
            fill = data.get("header", {}).get("fill_value", -999)
            for feature in data["features"]:
                lon, lat, z = feature["geometry"]["coordinates"]
                value = feature["properties"]["parameter"][param].get("ANN")
                i, j = cell(lon, lat)
                idx = j * WIDTH + i
                if value is not None and value != fill:
                    grids[param][idx] = value
                if z is not None and z != fill:
                    elev[idx] = z
            if k % 36 == 35:
                print(f"  {param}: {k + 1}/{len(boxes)} boxes, "
                      f"{time.time() - start:.0f} s", flush=True)

    missing = {p: sum(1 for v in grids[p] if math.isnan(v)) for p in PARAMS}
    print(f"  missing cells: {missing}, elevation {sum(1 for v in elev if math.isnan(v))}")
    if any(v > size * 0.001 for v in missing.values()):
        sys.exit(f"too many empty cells: {missing}")

    def ints(values, scale):
        return [None if math.isnan(v) else int(round(v * scale)) for v in values]

    payload = {
        "_source": (
            "NASA Langley Research Center POWER Project, MERRA-2 climatology "
            "2001-2020 (annual means), via the POWER Climatology API. These data "
            "were obtained from the NASA Langley Research Center (LaRC) POWER "
            "Project funded through the NASA Earth Science/Applied Science "
            "Program."),
        "period": "2001-2020",
        "grid": {"west": -180, "south": -90, "dlon": DLON, "dlat": DLAT,
                 "width": WIDTH, "height": HEIGHT, "rows": "south to north"},
        # Tenths of a degree C, pascals, metres: integers, so the file gzips.
        "t2m_c10": ints(grids["T2M"], 10),
        "ps_pa": ints(grids["PS"], 1000),          # POWER's PS is in kPa
        "elev_m": ints(elev, 1),
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")

    # A sanity print against places anybody can check.
    for name, lat, lon in (("London", 51.5, -0.1), ("Quito", -0.2, -78.5),
                           ("Vostok", -78.5, 106.8), ("Singapore", 1.3, 103.8)):
        i, j = cell(lon, lat)
        idx = j * WIDTH + i
        print(f"  {name}: {grids['T2M'][idx]:.1f} C, {grids['PS'][idx]:.1f} kPa, "
              f"grid elevation {elev[idx]:.0f} m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
