#!/usr/bin/env python3
"""
The viewshed and kriging tools, against fixtures whose answers are known by
construction rather than by agreement with another GIS.

VIEWSHED. A flat plane (every cell visible: the sight line from an eye
1.7 m up rises toward the horizon, so the farthest sample on a ray is
always the highest angle), a planted ramp seen from its high end (every
cell visible for the same reason — terrain that is linear along the ray
gives tan(t) = A − h/(D·t), strictly increasing in t), and that same plane
with ONE wall cell dropped into the observer's row, which must block
exactly the cells behind it on that ray and nothing in front of it. The
no-wall control is run first, because "those cells are hidden" only means
something next to "those cells were visible a moment ago". Cell size, the
lon/lat → cell placement and the max_distance radius are checked against
arithmetic done by hand in the comments.

KRIGING. The model functions are checked at the points where they have
closed forms (γ(0) = 0, spherical = sill at the range, exponential =
nugget + 95% of the partial sill at the practical range). The empirical
variogram is checked on a planted one-dimensional chain whose lags and
squared differences are countable by eye. The predictor is checked where
ordinary kriging has exact answers: at a sample location with nugget 0 it
must return that sample (1e-6), anywhere among equal-valued samples it
must return that value (which is Σw = 1, the unbiasedness constraint),
and both must survive a variogram that was fitted rather than given.

Both tools' subprocess cases exercise the /jobs/tool contract itself — one
JSON object on stdin, progress on stdout, a nonzero exit whose LAST line is
"ERROR: <reason>" on failure — and the .asc round trip.

If scipy is missing on this machine the kriging checks assert the honest
"ERROR: scipy required" path instead, and say so rather than passing
silently.

Run: python3 GeoID_GIS/sidecar/tools/test_viewshed_kriging.py
Exit code = number of failures.
"""

import json
import math
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import viewshed as V  # noqa: E402
import kriging as K  # noqa: E402

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy required")
    sys.exit(1)

try:
    import scipy  # noqa: F401
    HAVE_SCIPY = True
except ImportError:
    HAVE_SCIPY = False

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


def near(name, got, want, tol):
    check(name, abs(got - want) <= tol, f"got {got}, want {want} ±{tol}")


def run_tool(tool, job):
    return subprocess.run(
        [sys.executable, os.path.join(HERE, tool)],
        input=json.dumps(job), capture_output=True, text=True,
    )


def last_line(proc):
    text = proc.stdout.strip()
    return text.split("\n")[-1] if text else ""


tmp = tempfile.mkdtemp(prefix="viewshed_kriging_test_")

# Two headers: a projected one (30 m cells, UTM-shaped origin) and a
# geographic one (0.001° cells over Etna). NROWS/NCOLS are shared.
NROWS, NCOLS = 9, 11
CELL_M = 30.0
PROJECTED = [("ncols", str(NCOLS)), ("nrows", str(NROWS)),
             ("xllcorner", "500000"), ("yllcorner", "4170000"),
             ("cellsize", "30"), ("NODATA_value", "-9999")]
GEOGRAPHIC = [("ncols", str(NCOLS)), ("nrows", str(NROWS)),
              ("xllcorner", "15"), ("yllcorner", "37.5"),
              ("cellsize", "0.001"), ("NODATA_value", "-9999")]
ALL_VALID = np.ones((NROWS, NCOLS), dtype=bool)


def write_fixture(path, grid, valid=None, header=None):
    V.write_asc(path, grid, ALL_VALID if valid is None else valid,
                PROJECTED if header is None else header, -9999.0)


# ── cell size in metres ─────────────────────────────────────────────────────

mx, my, geo = V.cell_metres(PROJECTED, NROWS)
check("cell metres: a projected header is metric on both axes",
      (mx, my, geo) == (30.0, 30.0, False), f"got {(mx, my, geo)}")

mx, my, geo = V.cell_metres(GEOGRAPHIC, NROWS)
# Centre latitude 37.5 + 9·0.001/2 = 37.5045°, so one cell spans
# 0.001·111320·cos(37.5045°) = 88.3108 m east and 0.001·110574 = 110.574 m
# north — the constants raster-analysis.js uses, and NOT equal per axis.
check("cell metres: a geographic header is detected", geo is True)
near("cell metres: east span at 37.5045°", mx, 88.3108, 1e-3)
near("cell metres: north span", my, 110.574, 1e-9)

# ── placing the observer ────────────────────────────────────────────────────

# Cell [col 4, row 2] of the geographic grid spans 15.004–15.005 east and,
# counting up from the south edge (row 2 of 9 is the 7th row from the
# bottom), 37.506–37.507 north. A lon/lat inside that box must resolve to
# it, and its exact centre must too.
check("observer: [lon, lat] inside a cell resolves to that cell",
      V.resolve_observer({"observer": [15.0041, 37.5061]}, GEOGRAPHIC, NCOLS, NROWS) == (4, 2))
check("observer: the cell centre resolves to the same cell",
      V.resolve_observer({"observer": [15.0045, 37.5065]}, GEOGRAPHIC, NCOLS, NROWS) == (4, 2))
check("observer: observer_cell=true reads `observer` as [col, row]",
      V.resolve_observer({"observer": [4, 2], "observer_cell": True},
                         GEOGRAPHIC, NCOLS, NROWS) == (4, 2))
check("observer: observer_cell may be the [col, row] pair itself",
      V.resolve_observer({"observer_cell": [4, 2]}, GEOGRAPHIC, NCOLS, NROWS) == (4, 2))
try:
    V.resolve_observer({"observer": [20.0, 37.5]}, GEOGRAPHIC, NCOLS, NROWS)
    check("observer: a point outside the grid is refused", False, "no ToolError")
except V.ToolError as exc:
    check("observer: a point outside the grid is refused", "outside" in str(exc), str(exc))

# ── flat plane: everything is visible ───────────────────────────────────────

flat = np.full((NROWS, NCOLS), 100.0)
vis = V.viewshed(flat, ALL_VALID, CELL_M, CELL_M, (5, 4))
check("flat plane: every cell is visible",
      int(vis.sum()) == NROWS * NCOLS, f"got {int(vis.sum())} of {NROWS * NCOLS}")
check("flat plane: the observer sees its own cell", int(vis[4, 5]) == 1)

# ── planted ramp: the high end sees the whole slope ─────────────────────────

# z = (NCOLS-1-col)·10, so column 0 stands 100 m above column 10 and the
# surface is a plane. From the top of a plane the ground falls away from
# the eye monotonically, so nothing can hide.
ramp = np.tile((NCOLS - 1 - np.arange(NCOLS)) * 10.0, (NROWS, 1))
vis = V.viewshed(ramp, ALL_VALID, CELL_M, CELL_M, (0, 4))
check("ramp: the slope line below the observer is all visible",
      vis[4, :].tolist() == [1] * NCOLS, f"got {vis[4, :].tolist()}")
check("ramp: every cell of the plane is visible",
      int(vis.sum()) == NROWS * NCOLS, f"got {int(vis.sum())} of {NROWS * NCOLS}")

# ── one wall cell blocks exactly what is behind it ──────────────────────────

# Flat ground at 0, eye 1.7 m up at [col 0, row 4]. Along row 4 every
# target angle is −1.7/(col·30), a negative number rising toward zero, so
# the running maximum is always the previous cell and the whole row is
# visible — the control.
control = V.viewshed(np.zeros((NROWS, NCOLS)), ALL_VALID, CELL_M, CELL_M, (0, 4))
check("wall control: with no wall the observer's row is all visible",
      control[4, :].tolist() == [1] * NCOLS, f"got {control[4, :].tolist()}")

# Now a 100 m wall in one cell, [col 5, row 4]. Its angle from the eye is
# (100 − 1.7)/(5·30) = +0.6553; every cell behind it on that row has a
# negative angle, so all of them are hidden and none in front of it is.
walled = np.zeros((NROWS, NCOLS))
walled[4, 5] = 100.0
vis = V.viewshed(walled, ALL_VALID, CELL_M, CELL_M, (0, 4))
check("wall: the cells in front of the wall stay visible",
      vis[4, :5].tolist() == [1] * 5, f"got {vis[4, :5].tolist()}")
check("wall: the wall cell itself is visible", int(vis[4, 5]) == 1)
check("wall: every cell behind the wall on that ray is hidden",
      vis[4, 6:].tolist() == [0] * (NCOLS - 6), f"got {vis[4, 6:].tolist()}")

# ── max_distance_m ──────────────────────────────────────────────────────────

# 100 m over 30 m cells is 3.333 cells, so an offset is inside the radius
# when Δcol² + Δrow² ≤ 11.11: (0,3) and (2,2) are, (0,4) and (2,3) are not.
vis = V.viewshed(np.zeros((NROWS, NCOLS)), ALL_VALID, CELL_M, CELL_M, (5, 4),
                 max_distance_m=100.0)
check("radius: a cell 3 cells away (90 m) is inside", int(vis[4, 8]) == 1)
check("radius: a cell 4 cells away (120 m) is outside", int(vis[4, 9]) == 0)
check("radius: the diagonal (2,2) at 84.9 m is inside", int(vis[6, 7]) == 1)
check("radius: the diagonal (3,2) at 108.2 m is outside", int(vis[7, 7]) == 0)

# ── nodata ──────────────────────────────────────────────────────────────────

holed_valid = ALL_VALID.copy()
holed_valid[4, 5] = False
vis = V.viewshed(np.zeros((NROWS, NCOLS)), holed_valid, CELL_M, CELL_M, (0, 4))
check("nodata: a hole in the DEM does not block the ray through it",
      vis[4, 6:].tolist() == [1] * (NCOLS - 6), f"got {vis[4, 6:].tolist()}")

# ── viewshed through the /jobs/tool contract ────────────────────────────────

src = os.path.join(tmp, "wall.asc")
out = os.path.join(tmp, "wall_viewshed.asc")
write_fixture(src, walled)
proc = run_tool("viewshed.py", {
    "params": {"observer": [0, 4], "observer_cell": True, "observer_height": 1.7},
    "inputs": [src], "output": out,
})
check("subprocess viewshed: exits 0", proc.returncode == 0, proc.stdout + proc.stderr)
grid, valid, header, nodata = V.read_asc(out)
keys = {k.lower(): v for k, v in header}
check("subprocess viewshed: georeferencing echoed back verbatim",
      keys.get("xllcorner") == "500000" and keys.get("yllcorner") == "4170000"
      and keys.get("cellsize") == "30" and grid.shape == (NROWS, NCOLS),
      f"got {keys}, shape {grid.shape}")
check("subprocess viewshed: the output is a 0/1 grid",
      set(np.unique(grid)) <= {0.0, 1.0}, f"got {sorted(set(np.unique(grid)))}")
check("subprocess viewshed: the wall's shadow survives the file",
      grid[4, :6].tolist() == [1] * 6 and grid[4, 6:].tolist() == [0] * (NCOLS - 6),
      f"got {grid[4, :].tolist()}")

# The DEM's nodata must still be nodata in the visibility grid.
src_hole = os.path.join(tmp, "hole.asc")
out_hole = os.path.join(tmp, "hole_viewshed.asc")
write_fixture(src_hole, np.zeros((NROWS, NCOLS)), holed_valid)
proc = run_tool("viewshed.py", {
    "params": {"observer_cell": [0, 4]}, "inputs": [src_hole], "output": out_hole,
})
check("subprocess viewshed: exits 0 over a holed DEM", proc.returncode == 0,
      proc.stdout + proc.stderr)
hgrid, hvalid, _h, _n = V.read_asc(out_hole)
check("subprocess viewshed: the DEM's hole is still nodata",
      not bool(hvalid[4, 5]) and int(hvalid.sum()) == NROWS * NCOLS - 1)

# A geographic DEM: the observer arrives as [lon, lat] and must land on the
# same cell resolve_observer computed above.
src_geo = os.path.join(tmp, "geo.asc")
out_geo = os.path.join(tmp, "geo_viewshed.asc")
V.write_asc(src_geo, ramp, ALL_VALID, GEOGRAPHIC, -9999.0)
proc = run_tool("viewshed.py", {
    "params": {"observer": [15.0005, 37.5045]},  # col 0, row 4
    "inputs": [src_geo], "output": out_geo,
})
check("subprocess viewshed: a geographic DEM takes a lon/lat observer",
      proc.returncode == 0, proc.stdout + proc.stderr)
check("subprocess viewshed: the log states the geographic cell size",
      "geographic header" in proc.stdout and "88.31" in proc.stdout,
      proc.stdout)
ggrid, _v, _h, _n = V.read_asc(out_geo)
check("subprocess viewshed: the ramp is fully visible from its high end",
      int(ggrid.sum()) == NROWS * NCOLS, f"got {int(ggrid.sum())}")

# Failure contract: nonzero exit and a final "ERROR: <reason>" line.
proc = run_tool("viewshed.py", {"params": {}, "inputs": [src], "output": out})
check("subprocess viewshed: a missing observer is a final ERROR: line",
      proc.returncode != 0 and last_line(proc).startswith("ERROR:"),
      repr(last_line(proc)))
proc = run_tool("viewshed.py", {"params": {"observer_cell": [999, 0]},
                                "inputs": [src], "output": out})
check("subprocess viewshed: an off-grid observer is a final ERROR: line",
      proc.returncode != 0 and last_line(proc).startswith("ERROR:"),
      repr(last_line(proc)))

# ── kriging ─────────────────────────────────────────────────────────────────

if not HAVE_SCIPY:
    print("\nscipy is NOT installed here — asserting the honest refusal "
          "instead of the kriging answers.")
    out_k = os.path.join(tmp, "kriged.asc")
    proc = run_tool("kriging.py", {
        "params": {"points": [[0, 0, 1], [1000, 0, 2]], "bounds": [0, 0, 1000, 1000]},
        "inputs": [], "output": out_k,
    })
    check("kriging without scipy: nonzero exit", proc.returncode != 0)
    check("kriging without scipy: the last line names scipy",
          last_line(proc) == "ERROR: scipy required", repr(last_line(proc)))
    check("kriging without scipy: no output file was written",
          not os.path.exists(out_k))
else:
    # Model shapes, at the distances where they have closed forms.
    # Partial sill 3 (sill 4, nugget 1):
    #   spherical γ(a/2) = 1 + 3(1.5·0.5 − 0.5·0.5³) = 1 + 3·0.6875 = 3.0625
    #   spherical γ(a)   = 1 + 3(1.5 − 0.5)          = 4 = the sill
    #   exponential γ(a) = 1 + 3(1 − e⁻³)            = 3.8506387949
    near("variogram: γ(0) = 0 (spherical)",
         float(K.variogram(0.0, "spherical", 100.0, 4.0, 1.0)), 0.0, 0.0)
    near("variogram: γ(0) = 0 (exponential)",
         float(K.variogram(0.0, "exponential", 100.0, 4.0, 1.0)), 0.0, 0.0)
    near("variogram: spherical at half the range",
         float(K.variogram(50.0, "spherical", 100.0, 4.0, 1.0)), 3.0625, 1e-12)
    near("variogram: spherical reaches the sill at the range",
         float(K.variogram(100.0, "spherical", 100.0, 4.0, 1.0)), 4.0, 1e-12)
    near("variogram: spherical stays at the sill beyond the range",
         float(K.variogram(250.0, "spherical", 100.0, 4.0, 1.0)), 4.0, 1e-12)
    near("variogram: exponential is 95% of the partial sill at the range",
         float(K.variogram(100.0, "exponential", 100.0, 4.0, 1.0)),
         3.8506387948964083, 1e-12)

    # Empirical variogram on a planted chain: six samples 100 m apart with
    # values 0..5. Pairs run out to 500 m, so lags are binned to 250 m and
    # only the 100 m pairs (5 of them, every squared difference 1) and the
    # 200 m pairs (4, every squared difference 4) survive. Matheron halves
    # the mean: γ̂(100) = 0.5 and γ̂(200) = 2.0 exactly.
    chain_xy = np.column_stack([np.arange(6) * 100.0, np.zeros(6)])
    chain_z = np.arange(6, dtype=float)
    centres, gam, counts = K.empirical_variogram(chain_xy, chain_z)
    check("empirical variogram: only the lags under half the span are kept",
          centres.size == 2, f"got {centres.size} lags at {centres.tolist()}")
    check("empirical variogram: pair counts are 5 at 100 m and 4 at 200 m",
          counts.tolist() == [5, 4], f"got {counts.tolist()}")
    near("empirical variogram: γ̂(100 m) = ½·mean(1²)", float(gam[0]), 0.5, 1e-12)
    near("empirical variogram: γ̂(200 m) = ½·mean(2²)", float(gam[1]), 2.0, 1e-12)

    # Exactness. With nugget 0 the right-hand side at a sample location IS
    # that sample's column of the left-hand side, so the weights are a unit
    # vector and the prediction is the datum — for either model.
    pts = np.array([
        [0.0, 0.0], [1200.0, 300.0], [2500.0, 900.0],
        [400.0, 2100.0], [1800.0, 2600.0], [2900.0, 100.0],
    ])
    vals = np.array([12.0, 18.5, 7.25, 22.0, 3.5, 15.75])
    for model in ("spherical", "exponential"):
        got = K.ordinary_kriging(pts, vals, pts, model, 5000.0, 10.0, 0.0)
        worst = float(np.max(np.abs(got - vals)))
        check(f"kriging ({model}): exact at every sample location",
              worst <= 1e-6, f"worst error {worst:g}")

    # Unbiasedness, two ways. Two equal-valued samples: the weights sum to
    # one, so the midpoint — and anywhere else — is that value.
    pair = np.array([[0.0, 0.0], [1000.0, 0.0]])
    same = np.array([5.0, 5.0])
    mid = K.ordinary_kriging(pair, same, np.array([[500.0, 0.0]]),
                             "spherical", 800.0, 2.0, 0.0)
    near("kriging: the midpoint of two equal samples is that value",
         float(mid[0]), 5.0, 1e-9)
    flat_pts = np.array([[0.0, 0.0], [900.0, 100.0], [200.0, 800.0],
                         [1100.0, 950.0], [500.0, 450.0]])
    flat_vals = np.full(5, 7.0)
    anywhere = K.ordinary_kriging(flat_pts, flat_vals,
                                  np.array([[300.0, 200.0], [5000.0, 5000.0]]),
                                  "spherical", 700.0, 1.0, 0.0)
    check("kriging: a constant field stays constant everywhere (Σw = 1)",
          float(np.max(np.abs(anywhere - 7.0))) <= 1e-9, f"got {anywhere.tolist()}")

    # The fitted path: nothing given but the model, and exactness must
    # survive whatever range and sill the fit chose.
    centres, gam, counts = K.empirical_variogram(pts, vals)
    rng, sill, how = K.fit_variogram(centres, gam, counts, "spherical", 0.0,
                                     float(np.var(vals)))
    check("kriging fit: a positive range and sill come back",
          rng > 0 and sill > 0, f"range {rng}, sill {sill}, how {how}")
    check("kriging fit: the log can say where the numbers came from",
          how in ("least squares", "method of moments"), how)
    got = K.ordinary_kriging(pts, vals, pts, "spherical", rng, sill, 0.0)
    check("kriging fit: still exact at the samples with a fitted variogram",
          float(np.max(np.abs(got - vals))) <= 1e-6,
          f"worst {float(np.max(np.abs(got - vals))):g}")

    # A supplied parameter is never overwritten by the fit.
    rng2, sill2, how2 = K.fit_variogram(centres, gam, counts, "spherical", 0.0,
                                        float(np.var(vals)), 1234.0, 56.0)
    check("kriging fit: supplied range and sill are passed straight through",
          (rng2, sill2, how2) == (1234.0, 56.0, "given"), f"got {(rng2, sill2, how2)}")

    # ── kriging through the /jobs/tool contract ────────────────────────────
    # bounds 10..11 E, 40..41 N with 10 columns gives 0.1° cells, so cell
    # centres sit at 10.05, 10.15, … A sample planted at 10.25/40.25 lands
    # exactly on the centre of column 2, row 7 (rows count from the north:
    # 41 − 7.5·0.1 = 40.25), and with nugget 0 that cell must come back
    # holding the sample's own value.
    out_k = os.path.join(tmp, "kriged.asc")
    proc = run_tool("kriging.py", {
        "params": {
            "points": [[10.25, 40.25, 12.0], [10.75, 40.75, 30.0],
                       [10.25, 40.75, 21.0], [10.75, 40.25, 5.0]],
            "model": "spherical", "range_m": 60000.0, "sill": 10.0,
            "nugget": 0, "cells_across": 10, "bounds": [10, 40, 11, 41],
        },
        "inputs": [], "output": out_k,
    })
    check("subprocess kriging: exits 0", proc.returncode == 0, proc.stdout + proc.stderr)
    kgrid, kvalid, kheader, knodata = V.read_asc(out_k)
    kkeys = {k.lower(): v for k, v in kheader}
    check("subprocess kriging: the grid is 10x10 with 0.1 degree cells",
          kgrid.shape == (10, 10) and float(kkeys["cellsize"]) == 0.1
          and float(kkeys["xllcorner"]) == 10.0 and float(kkeys["yllcorner"]) == 40.0,
          f"shape {kgrid.shape}, header {kkeys}")
    near("subprocess kriging: the cell holding a sample returns that sample",
         float(kgrid[7, 2]), 12.0, 1e-6)
    near("subprocess kriging: and the sample in the opposite corner",
         float(kgrid[2, 7]), 30.0, 1e-6)
    check("subprocess kriging: every cell is a finite number",
          bool(np.all(np.isfinite(kgrid))))

    # Fitted end to end: no range_m, no sill, no bounds — the tool must
    # still produce a grid and still honour the samples.
    out_fit = os.path.join(tmp, "kriged_fit.asc")
    proc = run_tool("kriging.py", {
        "params": {"points": [[10.25, 40.25, 12.0], [10.75, 40.75, 30.0],
                              [10.25, 40.75, 21.0], [10.75, 40.25, 5.0],
                              [10.5, 40.5, 17.0]],
                   "cells_across": 8},
        "inputs": [], "output": out_fit,
    })
    check("subprocess kriging: fits the variogram when none is given",
          proc.returncode == 0, proc.stdout + proc.stderr)
    check("subprocess kriging: the log reports the fitted variogram",
          "variogram spherical" in proc.stdout, proc.stdout)
    fgrid, _v, _h, _n = V.read_asc(out_fit)
    check("subprocess kriging: the fitted grid is finite throughout",
          bool(np.all(np.isfinite(fgrid))) and fgrid.shape[1] == 8,
          f"shape {fgrid.shape}")

    # The 2000-point cap is a refusal, not a truncation.
    many = [[float(i % 50), float(i // 50), float(i)] for i in range(2001)]
    proc = run_tool("kriging.py", {
        "params": {"points": many, "bounds": [0, 0, 50, 50], "cells_across": 4},
        "inputs": [], "output": os.path.join(tmp, "too_many.asc"),
    })
    check("subprocess kriging: 2001 points is a final ERROR: line, not a truncation",
          proc.returncode != 0 and last_line(proc).startswith("ERROR:")
          and "2000" in last_line(proc), repr(last_line(proc)))
    check("subprocess kriging: the capped run wrote nothing",
          not os.path.exists(os.path.join(tmp, "too_many.asc")))

    proc = run_tool("kriging.py", {"params": {}, "inputs": [],
                                   "output": os.path.join(tmp, "nope.asc")})
    check("subprocess kriging: missing points is a final ERROR: line",
          proc.returncode != 0 and last_line(proc).startswith("ERROR:"),
          repr(last_line(proc)))

    proc = run_tool("kriging.py", {
        "params": {"points": [[10, 40, 1.0], [10.5, 40.5, 2.0]],
                   "bounds": [10, 40, 10, 41]},  # zero span east-west
        "inputs": [], "output": os.path.join(tmp, "flatbounds.asc"),
    })
    check("subprocess kriging: bounds with no span are a final ERROR: line",
          proc.returncode != 0 and last_line(proc).startswith("ERROR:")
          and "span" in last_line(proc), repr(last_line(proc)))

    # Duplicated sample locations are singular with nugget 0, and saying so
    # is better than returning a grid of nan.
    proc = run_tool("kriging.py", {
        "params": {"points": [[10.2, 40.2, 1.0], [10.2, 40.2, 9.0], [10.6, 40.6, 4.0]],
                   "range_m": 50000.0, "sill": 4.0, "cells_across": 4,
                   "bounds": [10, 40, 11, 41]},
        "inputs": [], "output": os.path.join(tmp, "dup.asc"),
    })
    check("subprocess kriging: duplicated locations are refused with a reason",
          proc.returncode != 0 and last_line(proc).startswith("ERROR:")
          and "share a location" in last_line(proc), repr(last_line(proc)))

print(f"\n{failures} failure(s)")
sys.exit(failures)
