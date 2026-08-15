#!/usr/bin/env python3
"""
The hydrology tool, against synthetic DEMs whose answers are known by
construction.

Every fixture is chosen so the right answer is arithmetic, not another
hydrology program's output: a tilted plane (every D8 arrow points straight
downslope, and the low edge accumulates exactly its row), a cone (radial
convergence into a single basin), a plane with a one-cell pit (fill must
raise it to its spill point and the flow line must run THROUGH it again),
and a plane with a nodata hole (the hole stays nodata end to end and flow
detours around it without losing a cell — pinned by mass conservation at
the sinks, not by eyeballing). The pit fixture also runs unfilled as a
control, because "accumulation is continuous" only means something next to
the truncation the pit causes without the fill.

The subprocess cases exercise the /jobs/tool contract itself — one JSON
object on stdin, progress on stdout, ERROR: as the final line on failure —
and the .asc round trip, including the 1e-5 epsilon surviving text form.

Run: python3 GeoID_GIS/sidecar/tools/test_hydrology.py
Exit code = number of failures.
"""

import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hydrology as H  # noqa: E402

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy required")
    sys.exit(1)

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


def near(name, got, want, tol):
    check(name, abs(got - want) <= tol, f"got {got}, want {want} ±{tol}")


def downstream_of(fdir, r, c):
    dr, dc = H.CODE_OFFSET[int(fdir[r, c])]
    return r + dr, c + dc


def arrows_strictly_downslope(z, fdir, valid):
    """The one invariant every D8 grid must hold: a non-sink arrow points at
    strictly lower ground."""
    for r, c in zip(*np.nonzero(valid & (fdir != 0))):
        nr, nc = downstream_of(fdir, r, c)
        if not z[nr, nc] < z[r, c]:
            return False
    return True


def write_fixture(path, grid, valid, nodata=-9999.0, integer=False):
    header = [
        ("ncols", str(grid.shape[1])),
        ("nrows", str(grid.shape[0])),
        ("xllcorner", "500000"),
        ("yllcorner", "4170000"),
        ("cellsize", "10"),
        ("NODATA_value", str(int(nodata))),
    ]
    H.write_asc(path, grid, valid, header, nodata, integer=integer)


def run_tool(job):
    tool = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hydrology.py")
    return subprocess.run(
        [sys.executable, tool],
        input=json.dumps(job),
        capture_output=True,
        text=True,
    )


# ── tilted plane: z = column, so water runs due west along each row ────────

NR, NC = 5, 6
plane = np.tile(np.arange(NC, dtype=float), (NR, 1))
all_valid = np.ones((NR, NC), dtype=bool)

fdir = H.d8_flow_dir(plane, all_valid)
# Cardinal west (drop 1) always beats the diagonals (drop 1/sqrt2), so
# every arrow off the low edge is code 16 and the low edge is sinks.
check("tilted plane: every interior arrow points due west (16)",
      bool(np.all(fdir[:, 1:] == 16)))
check("tilted plane: the low edge is all sinks",
      bool(np.all(fdir[:, 0] == 0)))
check("tilted plane: arrows are strictly downslope",
      arrows_strictly_downslope(plane, fdir, all_valid))

acc = H.accumulation(fdir, all_valid)
# Each row is an independent west-running chain, so accumulation at the
# low edge is the whole row — the column count — and mid-column it is
# the count of cells at-or-east of it (self-inclusive convention).
check("tilted plane: low-edge accumulation = column count",
      bool(np.all(acc[:, 0] == NC)), f"got {acc[:, 0].tolist()}")
check("tilted plane: mid-column accumulation = upstream line incl. self",
      bool(np.all(acc[:, 2] == NC - 2)))
check("tilted plane: high edge accumulates only itself",
      bool(np.all(acc[:, -1] == 1)))

# Streams: acc runs 6,5,4,3,2,1 across each row, so threshold 3 flags
# exactly columns 0..3 — 4 cells per row.
streams = H.stream_grid(acc, 3)
check("streams: threshold 3 flags columns 0-3",
      bool(np.all(streams[:, :4] == 1)) and bool(np.all(streams[:, 4:] == 0)))
check("streams: flagged count is rows x 4", int(streams.sum()) == NR * 4)

# No outlets: each row drains to its own edge sink, so the basins are
# exactly the rows — nrows labels, ncols cells each, constant per row.
labels = H.watershed(fdir, all_valid, None)
check("watershed (edge sinks): one basin per row",
      len(np.unique(labels)) == NR)
check("watershed (edge sinks): every basin is a whole row",
      all(len(np.unique(labels[r, :])) == 1 for r in range(NR))
      and all(int((labels == labels[r, 0]).sum()) == NC for r in range(NR)))

# ── cone: z = distance from centre, so everything converges radially ───────

C = 4
rows, cols = np.mgrid[0:9, 0:9]
cone = np.hypot(rows - C, cols - C)
cone_valid = np.ones_like(cone, dtype=bool)

fdir = H.d8_flow_dir(cone, cone_valid)
check("cone: the centre is the only sink",
      int((fdir == 0).sum()) == 1 and fdir[C, C] == 0)
# Radial convergence: every step moves strictly closer to the centre —
# a stronger claim than "downslope", and true by construction here.
converges = True
for r, c in zip(*np.nonzero(fdir != 0)):
    dr_, dc_ = downstream_of(fdir, r, c)
    if not np.hypot(dr_ - C, dc_ - C) < np.hypot(r - C, c - C):
        converges = False
check("cone: every arrow moves strictly closer to the centre", converges)

acc = H.accumulation(fdir, cone_valid)
check("cone: the centre accumulates every cell", int(acc[C, C]) == 81)

labels = H.watershed(fdir, cone_valid, [[C, C]])
check("cone: outlet at the centre claims all 81 cells",
      bool(np.all(labels == 1)))
check("cone: with no outlets it is still a single basin",
      len(np.unique(H.watershed(fdir, cone_valid, None))) == 1)

# ── one-cell pit in the plane: fill to the spill, flow runs through ────────

pit = plane.copy()
pit[2, 3] = -5.0  # a hole 7 units under its own ground

# Control first: unfilled, the pit swallows everything east of it in its
# row, so the low edge only collects (2,0) and (2,1). This is the number
# the fill exists to repair.
fdir_raw = H.d8_flow_dir(pit, all_valid)
acc_raw = H.accumulation(fdir_raw, all_valid)
check("pit control: unfilled, the pit truncates its row at the low edge",
      int(acc_raw[2, 0]) == 2, f"got {int(acc_raw[2, 0])}")

filled = H.fill_depressions(pit, all_valid, eps=1e-5)
# The pit's lowest escape is over its z=2 neighbours, so the spill point
# elevation is 2; the epsilon puts it a hair above so it drains.
near("fill: pit raised to its spill point", filled[2, 3], 2.0, 1e-3)
check("fill: raised strictly ABOVE the spill (epsilon gradient)",
      filled[2, 3] > 2.0)
check("fill: no other cell moved",
      int((filled != pit).sum()) == 1)

fdir = H.d8_flow_dir(filled, all_valid)
# eps down to (2,2) cardinal beats eps/sqrt2 to the diagonals, so the
# filled pit rejoins the westward flow line it interrupted.
check("fill: the filled pit's arrow resumes due west", int(fdir[2, 3]) == 16)
acc = H.accumulation(fdir, all_valid)
# The filled pit sits at spill level (~2), genuinely LOWER than the plain
# plane's z=3 there, so the diagonals (1,4) and (3,4) now capture into it:
# their drop 2/sqrt2 ≈ 1.41 beats their cardinal 1. Known by construction:
# acc[2,3] = self + its east pair + two captured pairs = 1+2+2+2 = 7, and
# row 2's edge collects 7+3 = 10 while rows 1 and 3 keep only 4 each.
check("fill: accumulation is continuous through the filled pit",
      int(acc[2, 3]) == 7, f"got {int(acc[2, 3])}")
check("fill: the pit row's edge collects its row plus both captures",
      int(acc[2, 0]) == 10, f"got {int(acc[2, 0])}")
check("fill: low-edge profile matches the capture arithmetic",
      acc[:, 0].tolist() == [6, 4, 10, 4, 6], f"got {acc[:, 0].tolist()}")
check("fill: no cell was lost or double-counted (edge sum = cell count)",
      int(acc[:, 0].sum()) == NR * NC)

# ── nodata hole: flow detours, nothing enters it, nothing is lost ──────────

hole_valid = all_valid.copy()
hole_valid[2, 2] = False

fdir = H.d8_flow_dir(plane, hole_valid)
down = H._downstream_index(fdir, hole_valid)
hole_index = 2 * NC + 2
check("nodata: no arrow points into the hole",
      not bool(np.any(down == hole_index)))
# (2,3)'s westward neighbour is the hole, so its best remaining drops are
# the two z=2 diagonals at 1/sqrt2; SW (code 8) is first in ESRI order.
check("nodata: the cell east of the hole detours SW (code 8)",
      int(fdir[2, 3]) == 8)

acc = H.accumulation(fdir, hole_valid)
# Mass conservation: every valid cell drains to exactly one sink, so the
# sink totals must sum to the valid-cell count — the honest "nothing was
# dropped at the hole" measure.
sinks = (fdir == 0) & hole_valid
check("nodata: sink totals conserve every valid cell",
      int(acc[sinks].sum()) == int(hole_valid.sum()))
# Exact routing: row 2 keeps only itself and (2,1); the detoured branch
# (2,3)..(2,5) joins row 3 at (3,2), so row 3's edge collects 6 + 3.
check("nodata: the broken row's edge keeps only 2 cells", int(acc[2, 0]) == 2)
check("nodata: the detoured branch lands on the next row's edge",
      int(acc[3, 0]) == 9)

# ── the /jobs/tool contract, end to end through .asc files ─────────────────

tmp = tempfile.mkdtemp(prefix="hydrology_test_")

# "all" on the nodata plane: fill -> d8 -> accumulation written, nodata
# and georeferencing preserved through both text round trips.
src = os.path.join(tmp, "hole.asc")
out = os.path.join(tmp, "hole_acc.asc")
write_fixture(src, plane, hole_valid)
proc = run_tool({"params": {"operation": "all"}, "inputs": [src], "output": out})
check("subprocess all: exits 0", proc.returncode == 0, proc.stdout + proc.stderr)
grid, valid, header, nodata = H.read_asc(out)
keys = {k.lower(): v for k, v in header}
check("subprocess all: georeferencing echoed back verbatim",
      keys.get("xllcorner") == "500000" and keys.get("yllcorner") == "4170000"
      and keys.get("cellsize") == "10"
      and grid.shape == (NR, NC))
check("subprocess all: the hole is still nodata", not bool(valid[2, 2]))
check("subprocess all: accumulation matches the direct computation",
      int(grid[3, 0]) == 9 and int(grid[2, 0]) == 2 and int(grid[0, 0]) == NC)

# "fill" round trip: the epsilon is 1e-5 and the writer keeps 10
# significant digits, so strictly-above-spill must SURVIVE the file.
src2 = os.path.join(tmp, "pit.asc")
out2 = os.path.join(tmp, "pit_filled.asc")
write_fixture(src2, pit, all_valid)
proc = run_tool({"params": {"operation": "fill"}, "inputs": [src2], "output": out2})
check("subprocess fill: exits 0", proc.returncode == 0, proc.stdout + proc.stderr)
filled_grid, _v, _h, _n = H.read_asc(out2)
check("subprocess fill: epsilon gradient survives the text round trip",
      2.0 < filled_grid[2, 3] <= 2.001, f"got {filled_grid[2, 3]!r}")

# "streams" exercises params.threshold plumbing and the 0/1 output.
src3 = os.path.join(tmp, "plane.asc")
out3 = os.path.join(tmp, "plane_streams.asc")
write_fixture(src3, plane, all_valid)
proc = run_tool({"params": {"operation": "streams", "threshold": 3},
                 "inputs": [src3], "output": out3})
check("subprocess streams: exits 0", proc.returncode == 0, proc.stdout + proc.stderr)
sgrid, _v, _h, _n = H.read_asc(out3)
check("subprocess streams: 0/1 grid flags rows x 4 cells",
      set(np.unique(sgrid)) <= {0.0, 1.0} and int(sgrid.sum()) == NR * 4)

# Failure contract: nonzero exit and a final "ERROR: <reason>" line —
# that line is what the sidecar's job log shows a user.
proc = run_tool({"params": {"operation": "erode"}, "inputs": [src3], "output": out3})
last_line = proc.stdout.strip().split("\n")[-1] if proc.stdout.strip() else ""
check("subprocess bad op: nonzero exit with a final ERROR: line",
      proc.returncode != 0 and last_line.startswith("ERROR:"), repr(last_line))

print(f"\n{failures} failure(s)")
sys.exit(failures)
