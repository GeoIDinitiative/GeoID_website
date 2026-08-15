#!/usr/bin/env python3
"""
viewshed.py — sidecar tool: binary viewshed over an ESRI ASCII DEM.

/jobs/tool contract: the sidecar runs `python3 sidecar/tools/viewshed.py`
with ONE JSON object on stdin:

    { "params": {...}, "inputs": ["<abs path>", ...], "output": "<abs path>" }

Progress lines go to stdout (they stream into the job log). Exit 0 on
success; nonzero with a final "ERROR: <reason>" line on failure. numpy is
required and its absence is reported the same way ("ERROR: numpy required")
rather than as a traceback, because the job log is what a user sees.

inputs[0] is a DEM (.asc); output is a 0/1 grid (.asc) written under the
DEM's own header — 1 where that cell's ground (plus target_height) can be
seen from the observer's eye. Nodata cells stay nodata.

params
    observer         [lon, lat] in the grid's own CRS (the default), or
                     [col, row] when observer_cell is set
    observer_cell    true — read `observer` as [col, row]; or the pair
                     [col, row] itself
    observer_height  metres above the terrain at the observer cell (1.7)
    target_height    metres above the terrain at each target cell (0)
    max_distance_m   null for no limit, else a radius in metres beyond
                     which a cell is reported not visible

CELL SIZE IN METRES. A projected grid is already metric, so the header's
cellsize is used for both axes. When the origin looks geographic
(|xllcorner| <= 360 and cellsize < 1) the axes are converted the way the
browser does in raster-analysis.js `cellSizeMetres`: 111320·cos(lat) metres
per degree of longitude at the grid's centre latitude, 110574 metres per
degree of latitude. The two axes are therefore NOT equal on a geographic
grid, and the ray distances below carry both.

ALGORITHM — R3, one ray per cell.

For every cell the ray from the observer to it is walked in
max(|Δrow|, |Δcol|) steps — the Bresenham traversal — and the terrain
angle (rise over run, kept as a tangent: monotone in the angle and cheaper)
is compared against the largest angle seen so far along that ray. The cell
is visible when its own angle, including target_height, is at least that
running maximum. Equality counts as visible: a cell exactly on the sight
line is on it, not behind it.

The profile is sampled by BILINEAR INTERPOLATION at the point where the ray
crosses each step, not by reading the nearest cell, and that is correctness
rather than polish — reading the nearest cell makes a planar slope occlude
itself. A Bresenham cell sits up to half a cell off the true line, so its
horizontal run is shorter than the line's while its elevation is the
line's, and its angle comes out ABOVE the target's: on a ray of slope ½
over a 10 m/cell ramp with the eye 1.7 m up, −0.827 against the target's
−0.933, and ground in plain sight is reported hidden. Measured over a whole
plane — the ramp fixture in test_viewshed_kriging.py, seen from its high
corner — nearest-cell sampling calls 40 of 99 cells visible (36 if the
Bresenham tie breaks the other way) where the answer is 99. Interpolated,
terrain that is linear along the ray gives tan(t) = A + B/t with
B = −observer_height, strictly increasing in t, so the far end of a ramp is
always the maximum and the whole slope is visible — the answer a plane must
give.

Nodata along a ray is unknown ground, so it neither blocks nor is claimed
visible: a sample whose four bilinear corners are all nodata is skipped and
cannot raise the running maximum, a partly-nodata neighbourhood is read
from the corners that do exist (renormalised, as smooth.py's mean is), and
a nodata TARGET stays nodata in the output.

COMPLEXITY: one ray of at most d = max(nrows, ncols) steps for each of the
n cells — O(n·d), i.e. O(n^1.5) on a square grid. That is acceptable at DEM
sizes and is stated because it is the reason to window a national DEM
before pointing this at it. Rays are evaluated one Chebyshev ring at a time
so that every cell with the same step count is a single numpy pass; the
arithmetic is identical to walking them one at a time.

Input/output format: ESRI ASCII grid (.asc) — the reader and writer are
hydrology.py's, copied rather than imported because each tool is a
standalone subprocess, with the same header echo and the same nodata
behaviour.
"""

import json
import math
import os
import sys

try:
    import numpy as np
except ImportError:  # reported via main()'s contract line, not a traceback
    np = None


class ToolError(Exception):
    """An expected failure — becomes the job's final ERROR: line."""


# ── ESRI ASCII grid I/O (identical to hydrology.py's) ───────────────────────

_HEADER_KEYS = {
    "ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter",
    "cellsize", "nodata_value",
}


def read_asc(path):
    """Parse an ESRI ASCII grid.

    Returns (grid float64 [nrows, ncols], valid bool mask, header, nodata)
    where header is the ordered list of (key-as-written, value-as-written)
    lines so write_asc can hand the same georeferencing back untouched.
    """
    with open(path, "r", encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    header = []
    data_start = 0
    for i, line in enumerate(lines):
        parts = line.split()
        if len(parts) == 2 and parts[0].lower() in _HEADER_KEYS:
            header.append((parts[0], parts[1]))
            data_start = i + 1
        elif parts:
            break  # first data row
    keys = {k.lower(): v for k, v in header}
    for required in ("ncols", "nrows", "cellsize"):
        if required not in keys:
            raise ToolError(f"{os.path.basename(path)}: missing {required} in .asc header")
    ncols, nrows = int(keys["ncols"]), int(keys["nrows"])
    nodata = float(keys.get("nodata_value", -9999))
    values = np.array(" ".join(lines[data_start:]).split(), dtype=np.float64)
    if values.size != nrows * ncols:
        raise ToolError(
            f"{os.path.basename(path)}: expected {nrows * ncols} values, found {values.size}"
        )
    grid = values.reshape(nrows, ncols)
    # Exact-match nodata with a hair of float tolerance: the value came
    # through decimal text twice and must still be recognised.
    valid = ~np.isclose(grid, nodata, rtol=0.0, atol=1e-9)
    return grid, valid, header, nodata


def write_asc(path, grid, valid, header, nodata, integer=False):
    """Write a grid under the header read_asc captured.

    Georeferencing lines are echoed verbatim; NODATA_value is re-formatted
    to match the grid's own number format so the file stays self-consistent.
    """
    def fmt(v):
        return str(int(round(v))) if integer else format(float(v), ".10g")

    out_lines = []
    saw_nodata = False
    for key, value in header:
        if key.lower() == "nodata_value":
            out_lines.append(f"{key} {fmt(nodata)}")
            saw_nodata = True
        else:
            out_lines.append(f"{key} {value}")
    if not saw_nodata:
        out_lines.append(f"NODATA_value {fmt(nodata)}")
    body = np.where(valid, grid, nodata)
    for row in body:
        out_lines.append(" ".join(fmt(v) for v in row))
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out_lines) + "\n")


# ── georeferencing helpers ──────────────────────────────────────────────────

def header_value(header, *names):
    """The first of `names` present in the header, as a float, else None."""
    keys = {k.lower(): v for k, v in header}
    for name in names:
        if name in keys:
            try:
                return float(keys[name])
            except ValueError:
                raise ToolError(f"header {name} is not a number: {keys[name]!r}")
    return None


def origin_corner(header):
    """(x, y) of the grid's lower-left CORNER, from either header variant."""
    cellsize = header_value(header, "cellsize")
    x = header_value(header, "xllcorner")
    if x is None:
        centre = header_value(header, "xllcenter")
        x = None if centre is None else centre - cellsize / 2.0
    y = header_value(header, "yllcorner")
    if y is None:
        centre = header_value(header, "yllcenter")
        y = None if centre is None else centre - cellsize / 2.0
    return x, y


def cell_metres(header, nrows):
    """(metres per column step, metres per row step, geographic?).

    Projected grids are metric already. A geographic grid — |x| <= 360 with
    a cellsize under one unit, which no projected grid in metres has — is
    converted per axis at the grid's centre latitude, the same constants
    raster-analysis.js uses so the sidecar and the browser agree.
    """
    cellsize = header_value(header, "cellsize")
    if cellsize is None or cellsize <= 0:
        raise ToolError("cellsize must be a positive number")
    xll, yll = origin_corner(header)
    geographic = xll is not None and abs(xll) <= 360.0 and cellsize < 1.0
    if not geographic:
        return cellsize, cellsize, False
    mid_lat = (0.0 if yll is None else yll) + nrows * cellsize / 2.0
    mid_lat = max(-89.9, min(89.9, mid_lat))
    mx = abs(cellsize * 111320.0 * math.cos(math.radians(mid_lat)))
    my = abs(cellsize * 110574.0)
    if mx <= 0 or my <= 0:
        raise ToolError("the grid's cell size works out to zero metres")
    return mx, my, True


def resolve_observer(params, header, ncols, nrows):
    """(col, row) of the observer from params.observer / params.observer_cell."""
    cell = params.get("observer_cell")
    obs = params.get("observer")
    pair = None
    if isinstance(cell, (list, tuple)):
        pair = cell                      # the cell was given directly
    elif cell:
        pair = obs                       # a flag: `observer` IS [col, row]
    if pair is not None:
        try:
            col = int(round(float(pair[0])))
            row = int(round(float(pair[1])))
        except (TypeError, ValueError, IndexError):
            raise ToolError(f"observer cell must be [col, row]; got {pair!r}")
    else:
        if not isinstance(obs, (list, tuple)) or len(obs) < 2:
            raise ToolError(
                "params.observer is required — [lon, lat], or [col, row] with observer_cell"
            )
        try:
            lon, lat = float(obs[0]), float(obs[1])
        except (TypeError, ValueError):
            raise ToolError(f"observer must be two numbers; got {obs!r}")
        cellsize = header_value(header, "cellsize")
        xll, yll = origin_corner(header)
        if xll is None or yll is None:
            raise ToolError(
                "the grid has no xll/yll origin, so [lon, lat] cannot be placed "
                "— pass the observer as [col, row] with observer_cell"
            )
        col = int(math.floor((lon - xll) / cellsize))
        row = nrows - 1 - int(math.floor((lat - yll) / cellsize))  # row 0 = north
    if not (0 <= col < ncols and 0 <= row < nrows):
        raise ToolError(
            f"observer resolves to cell [{col}, {row}], outside the {ncols}x{nrows} grid"
        )
    return col, row


# ── the viewshed ────────────────────────────────────────────────────────────

def bilinear(zf, X, Y):
    """Bilinear sample of a nan-holed grid at fractional (col, row).

    A nodata corner is given zero weight and the remaining corners are
    renormalised, so a sample beside a hole still reads; a sample with no
    valid corner at all returns nan, which the caller treats as unknown
    ground rather than as flat ground.
    """
    nrows, ncols = zf.shape
    x0 = np.clip(np.floor(X).astype(np.int64), 0, ncols - 2)
    y0 = np.clip(np.floor(Y).astype(np.int64), 0, nrows - 2)
    fx = X - x0
    fy = Y - y0
    num = np.zeros(np.shape(X), dtype=np.float64)
    wsum = np.zeros(np.shape(X), dtype=np.float64)
    for dy, wy in ((0, 1.0 - fy), (1, fy)):
        for dx, wx in ((0, 1.0 - fx), (1, fx)):
            v = zf[y0 + dy, x0 + dx]
            w = np.where(np.isnan(v), 0.0, wy * wx)
            num += np.where(np.isnan(v), 0.0, v) * w
            wsum += w
    return np.where(wsum > 1e-12, num / np.where(wsum > 1e-12, wsum, 1.0), np.nan)


def viewshed(z, valid, mx, my, observer, observer_height=1.7, target_height=0.0,
             max_distance_m=None, say=None):
    """0/1 visibility from `observer` (col, row). See the module docstring."""
    col0, row0 = observer
    nrows, ncols = z.shape
    if nrows < 2 or ncols < 2:
        raise ToolError("viewshed needs a grid at least 2x2")
    if not valid[row0, col0]:
        raise ToolError(f"the observer cell [{col0}, {row0}] is nodata")
    if max_distance_m is not None and max_distance_m <= 0:
        raise ToolError("params.max_distance_m must be positive (or null for no limit)")

    zf = np.where(valid, z.astype(np.float64), np.nan)
    z_eye = float(z[row0, col0]) + float(observer_height)

    dR, dC = np.meshgrid(np.arange(nrows) - row0, np.arange(ncols) - col0, indexing="ij")
    dR = dR.astype(np.float64)
    dC = dC.astype(np.float64)
    dist = np.hypot(dC * mx, dR * my)
    # The Bresenham step count of a ray is its Chebyshev distance, so cells
    # sharing one are exactly the cells whose rays have the same length.
    ring = np.maximum(np.abs(dR), np.abs(dC)).astype(np.int64)

    dRf, dCf, distf, zflat = dR.ravel(), dC.ravel(), dist.ravel(), zf.ravel()
    ringf = ring.ravel()
    order = np.argsort(ringf, kind="stable")
    rings = int(ringf.max())
    bounds = np.searchsorted(ringf[order], np.arange(rings + 2))

    vis = np.zeros(nrows * ncols, dtype=np.int8)
    vis[row0 * ncols + col0] = 1  # the observer sees its own cell

    marks = {max(1, int(rings * f)): int(f * 100) for f in (0.25, 0.5, 0.75)}
    for s in range(1, rings + 1):
        idx = order[bounds[s]:bounds[s + 1]]
        if max_distance_m is not None:
            idx = idx[distf[idx] <= max_distance_m]
        if idx.size:
            steps = np.arange(1, s, dtype=np.float64)
            # Cap each pass at about a million samples so a large DEM cannot
            # allocate a ring's whole profile matrix at once.
            block = max(1, int(1_000_000 // max(s, 1)))
            for start in range(0, idx.size, block):
                sub = idx[start:start + block]
                target = distf[sub]
                if steps.size:
                    # Multiply before dividing: (Δcol·k)/s is exact whenever
                    # the ray crosses a cell centre, which is what keeps an
                    # axis-aligned ray reading its cells and not their blend.
                    X = col0 + np.outer(dCf[sub], steps) / s
                    Y = row0 + np.outer(dRf[sub], steps) / s
                    run = np.outer(target, steps) / s
                    tan = (bilinear(zf, X, Y) - z_eye) / run
                    horizon = np.where(np.isnan(tan), -np.inf, tan).max(axis=1)
                else:
                    horizon = np.full(sub.size, -np.inf)  # a neighbour has no profile
                own = (zflat[sub] + target_height - z_eye) / target
                vis[sub] = (own >= horizon).astype(np.int8)
        if say and s in marks:
            say(f"[viewshed] {marks[s]}% of rings walked ({s} of {rings})")

    return vis.reshape(nrows, ncols)


# ── job entry point ─────────────────────────────────────────────────────────

def _say(msg):
    print(msg, flush=True)  # flushed so the sidecar's job log streams live


def _number(params, key, default):
    value = params.get(key, default)
    if value is None:
        value = default
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ToolError(f"params.{key} must be a number; got {value!r}")


def _run(job):
    params = job.get("params") or {}
    inputs = job.get("inputs") or []
    output = job.get("output")
    if not inputs:
        raise ToolError("inputs[0] (a DEM .asc) is required")
    if not output:
        raise ToolError("output path is required")
    src = inputs[0]
    if not os.path.isfile(src):
        raise ToolError(f"input not found: {src}")

    _say(f"reading {src}")
    z, valid, header, nodata = read_asc(src)
    nrows, ncols = z.shape
    _say(f"grid {nrows}x{ncols}, {int(valid.sum())} valid cells, nodata {nodata:g}")

    mx, my, geographic = cell_metres(header, nrows)
    _say(f"cell {mx:.4g} x {my:.4g} m ({'geographic header' if geographic else 'projected header'})")

    col0, row0 = resolve_observer(params, header, ncols, nrows)
    observer_height = _number(params, "observer_height", 1.7)
    target_height = _number(params, "target_height", 0.0)
    raw_limit = params.get("max_distance_m")
    limit = None if raw_limit is None or raw_limit == "" else _number(params, "max_distance_m", 0.0)
    _say(f"observer cell [{col0}, {row0}], ground {float(z[row0, col0]):.4g}, "
         f"eye +{observer_height:g} m, targets +{target_height:g} m, "
         f"radius {'none' if limit is None else f'{limit:g} m'}")

    vis = viewshed(z, valid, mx, my, (col0, row0), observer_height, target_height,
                   limit, say=_say)

    seen = int(vis[valid].sum())
    total = int(valid.sum())
    share = (100.0 * seen / total) if total else 0.0
    _say(f"visible {seen} of {total} valid cells ({share:.1f}%)")
    write_asc(output, vis, valid, header, nodata, integer=True)
    _say(f"wrote {output}")
    return 0


def main():
    if np is None:
        print("ERROR: numpy required", flush=True)
        return 1
    try:
        job = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        print(f"ERROR: stdin is not valid job JSON: {exc}", flush=True)
        return 1
    try:
        return _run(job)
    except ToolError as exc:
        print(f"ERROR: {exc}", flush=True)
        return 1
    except Exception as exc:  # keep the contract's final line even for bugs
        print(f"ERROR: {type(exc).__name__}: {exc}", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
