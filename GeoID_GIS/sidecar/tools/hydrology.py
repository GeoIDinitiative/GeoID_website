#!/usr/bin/env python3
"""
hydrology.py — sidecar tool: DEM hydrology on ESRI ASCII grids.

/jobs/tool contract: the sidecar runs `python3 sidecar/tools/hydrology.py`
with ONE JSON object on stdin:

    { "params": {...}, "inputs": ["<abs path>", ...], "output": "<abs path>" }

Progress lines go to stdout (they stream into the job log). Exit 0 on
success; nonzero with a final "ERROR: <reason>" line on failure. numpy is
required and its absence is reported the same way ("ERROR: numpy required")
rather than as a traceback, because the job log is what a user sees.

params.operation selects:

    fill            priority-flood pit fill (Barnes et al. 2014), +epsilon
    flow-direction  D8 steepest descent — ESRI codes 1(E) 2(SE) 4(S) 8(SW)
                    16(W) 32(NW) 64(N) 128(NE); 0 marks a sink
    accumulation    D8 flow accumulation in CELLS, self-inclusive (min 1),
                    computed in topological order (Kahn over the flow graph)
    watershed       integer basin labels draining to params.outlets
                    [[row, col], ...] (label = 1-based outlet index, 0 for
                    cells that reach no outlet), or — when outlets are
                    absent — one label per sink, so a filled DEM labels the
                    basin of every edge sink
    streams         accumulation >= params.threshold as a 0/1 grid
    all             fill -> d8 -> accumulation, the accumulation written,
                    because accumulation is what the flood recipe consumes

Every operation reads a DEM from inputs[0]. flow-direction, accumulation,
watershed and streams do NOT fill first — they compute on the input as
given, so chain a "fill" ahead of them or use "all". params.epsilon
(default 1e-5, elevation units) tunes the fill's flat-resolving gradient;
0 gives the plain (flat-leaving) fill.

Input/output format: ESRI ASCII grid (.asc) — the 6-line header
(ncols / nrows / xllcorner / yllcorner / cellsize / NODATA_value, with the
xllcenter/yllcenter variants accepted) followed by nrows lines of ncols
values, row 0 northmost. The header's georeferencing is written back
verbatim; only the NODATA_value line is re-formatted to match the output
grid's own number format. Nodata cells stay nodata end to end: they are
never sources, never receivers, and the fill treats them as ocean (a cell
beside a hole can drain into it).
"""

import heapq
import json
import os
import sys
from collections import deque

try:
    import numpy as np
except ImportError:  # reported via main()'s contract line, not a traceback
    np = None

SQRT2 = 2.0 ** 0.5

# D8 neighbours in ESRI code order: E, SE, S, SW, W, NW, N, NE. Scanning in
# this order with a strictly-greater comparison makes tie-breaking
# deterministic (first listed direction wins), which the tests rely on.
D8 = (
    (0, 1, 1.0, 1),
    (1, 1, SQRT2, 2),
    (1, 0, 1.0, 4),
    (1, -1, SQRT2, 8),
    (0, -1, 1.0, 16),
    (-1, -1, SQRT2, 32),
    (-1, 0, 1.0, 64),
    (-1, 1, SQRT2, 128),
)
CODE_OFFSET = {code: (dr, dc) for dr, dc, _d, code in D8}
NEIGHBOURS_8 = [(dr, dc) for dr, dc, _d, _c in D8]

OPERATIONS = ("fill", "flow-direction", "accumulation", "watershed", "streams", "all")


class ToolError(Exception):
    """An expected failure — becomes the job's final ERROR: line."""


# ── ESRI ASCII grid I/O ─────────────────────────────────────────────────────

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
    Floats carry 10 significant digits — enough for the fill's 1e-5 epsilon
    ramp to survive the text round trip on any realistic elevation.
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


# ── operations ──────────────────────────────────────────────────────────────

def fill_depressions(z, valid, eps=1e-5):
    """Priority-flood depression fill (Barnes et al. 2014), +epsilon variant.

    Flood inward from every outlet: the heap is seeded with all border
    cells plus every valid cell touching nodata (nodata is ocean — a hole
    in the grid is somewhere water can leave). Cells pop lowest-first; an
    unvisited neighbour is raised to at least popped + eps before being
    pushed. Terrain already higher keeps its own elevation, so cells that
    already drain are untouched — only pit floors and flats are raised.

    FLAT RESOLUTION: the epsilon is the whole strategy. The flood claims a
    depression's cells outward from its spill point in heap order, and each
    claimed cell sits eps above the neighbour that claimed it, so every
    filled surface is a monotone ramp descending toward the spill point.
    D8 run on the result therefore has a strictly-downhill arrow on every
    former flat, pointing back the way the flood came in — i.e. toward the
    spill. eps=0 degrades to the plain priority-flood, which leaves flats
    flat (and D8 then marks their interiors as sinks).
    """
    nrows, ncols = z.shape
    filled = z.astype(np.float64).copy()
    invalid = ~valid

    # Seeds: grid border plus the shore of every nodata hole.
    pad = np.zeros((nrows + 2, ncols + 2), dtype=bool)
    pad[1:-1, 1:-1] = invalid
    adjacent_to_hole = np.zeros_like(invalid)
    for dr, dc in NEIGHBOURS_8:
        adjacent_to_hole |= pad[1 + dr:1 + dr + nrows, 1 + dc:1 + dc + ncols]
    border = np.zeros_like(invalid)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    seeds = valid & (border | adjacent_to_hole)

    closed = invalid.copy()
    closed |= seeds
    heap = [(filled[r, c], r, c) for r, c in zip(*np.nonzero(seeds))]
    heapq.heapify(heap)
    while heap:
        elev, r, c = heapq.heappop(heap)
        for dr, dc in NEIGHBOURS_8:
            nr, nc = r + dr, c + dc
            if 0 <= nr < nrows and 0 <= nc < ncols and not closed[nr, nc]:
                closed[nr, nc] = True
                filled[nr, nc] = max(z[nr, nc], elev + eps)
                heapq.heappush(heap, (filled[nr, nc], nr, nc))
    return filled


def d8_flow_dir(z, valid):
    """D8 steepest descent as ESRI codes; 0 = sink (no strictly lower
    neighbour). Drops are divided by 1 / sqrt(2) cell distances — cellsize
    is a common factor and cannot change the argmax, so it is left out.
    Off-grid and nodata neighbours read as +inf, so flow can never leave
    the valid area sideways; a cell whose only descent is off-grid or into
    a hole is a sink, which is exactly what watershed/accumulation want.
    """
    nrows, ncols = z.shape
    zz = np.where(valid, z, np.inf)
    pad = np.full((nrows + 2, ncols + 2), np.inf)
    pad[1:-1, 1:-1] = zz
    fdir = np.zeros((nrows, ncols), dtype=np.int32)
    best = np.zeros((nrows, ncols))
    with np.errstate(invalid="ignore"):
        for dr, dc, dist, code in D8:
            nbr = pad[1 + dr:1 + dr + nrows, 1 + dc:1 + dc + ncols]
            drop = (zz - nbr) / dist
            better = drop > best  # strict: first-listed direction wins ties
            fdir[better] = code
            best = np.where(better, drop, best)
    fdir[~valid] = 0
    return fdir


def _downstream_index(fdir, valid):
    """Flat downstream index per cell; -1 for sinks and nodata."""
    nrows, ncols = fdir.shape
    down = np.full(nrows * ncols, -1, dtype=np.int64)
    for code, (dr, dc) in CODE_OFFSET.items():
        rows, cols = np.nonzero((fdir == code) & valid)
        down[rows * ncols + cols] = (rows + dr) * ncols + (cols + dc)
    return down


def accumulation(fdir, valid):
    """D8 accumulation in cells, self-inclusive (every valid cell starts at
    1). Kahn's topological order over the flow graph: cells with no inflow
    drain first, each pushes its total downstream once. D8 arrows are
    strictly downhill by construction so the graph is acyclic and one pass
    settles every cell — O(n), no recursion.
    """
    nrows, ncols = fdir.shape
    n = nrows * ncols
    down = _downstream_index(fdir, valid)
    acc = valid.ravel().astype(np.int64)
    indeg = np.zeros(n, dtype=np.int64)
    receivers = down[down >= 0]
    np.add.at(indeg, receivers, 1)
    queue = deque(int(i) for i in np.nonzero((indeg == 0) & valid.ravel())[0])
    while queue:
        i = queue.popleft()
        d = down[i]
        if d >= 0:
            acc[d] += acc[i]
            indeg[d] -= 1
            if indeg[d] == 0:
                queue.append(int(d))
    return acc.reshape(nrows, ncols)


def watershed(fdir, valid, outlets=None):
    """Label basins. With outlets: label = 1-based index of the FIRST outlet
    a cell's flow path passes through (an outlet claims itself and
    everything upstream of it; cells reaching no outlet get 0). Without
    outlets: every sink — a cell with no downstream, which on a filled DEM
    means every edge sink — gets its own label, and each cell inherits the
    label of the sink it drains to.

    Memoised downstream walk with an explicit stack: each cell's label is
    its own if it is an outlet/sink, else its downstream cell's, so paths
    are walked once and back-filled — O(n) total, no recursion depth limit.
    """
    nrows, ncols = fdir.shape
    n = nrows * ncols
    down = _downstream_index(fdir, valid)
    outlet_label = {}
    if outlets is not None:
        for k, rc in enumerate(outlets):
            try:
                r, c = int(rc[0]), int(rc[1])
            except (TypeError, ValueError, IndexError):
                raise ToolError(f"outlet {k} is not a [row, col] pair: {rc!r}")
            if not (0 <= r < nrows and 0 <= c < ncols):
                raise ToolError(f"outlet {k} [{r}, {c}] is outside the {nrows}x{ncols} grid")
            if not valid[r, c]:
                raise ToolError(f"outlet {k} [{r}, {c}] sits on nodata")
            outlet_label[r * ncols + c] = k + 1

    memo = np.full(n, -1, dtype=np.int64)
    next_sink_label = 1
    for start in np.nonzero(valid.ravel())[0]:
        path = []
        j = int(start)
        while True:
            if memo[j] != -1:
                label = memo[j]
                break
            if j in outlet_label:
                label = outlet_label[j]
                memo[j] = label
                break
            d = down[j]
            if d < 0:  # a sink
                if outlets is None:
                    label = next_sink_label
                    next_sink_label += 1
                else:
                    label = 0  # drains off-grid without meeting an outlet
                memo[j] = label
                break
            path.append(j)
            j = int(d)
        for cell in path:
            memo[cell] = label
    labels = np.where(valid.ravel(), np.maximum(memo, 0), 0)
    return labels.reshape(nrows, ncols).astype(np.int32)


def stream_grid(acc, threshold):
    """Cells whose accumulation clears the threshold, as 0/1."""
    return (acc >= threshold).astype(np.int32)


# ── job entry point ─────────────────────────────────────────────────────────

def _say(msg):
    print(msg, flush=True)  # flushed so the sidecar's job log streams live


def _run(job):
    params = job.get("params") or {}
    op = params.get("operation")
    if op not in OPERATIONS:
        raise ToolError(f"params.operation must be one of {', '.join(OPERATIONS)}; got {op!r}")
    inputs = job.get("inputs") or []
    if not inputs:
        raise ToolError("inputs[0] (a DEM .asc) is required")
    output = job.get("output")
    if not output:
        raise ToolError("output path is required")
    src = inputs[0]
    if not os.path.isfile(src):
        raise ToolError(f"input not found: {src}")

    _say(f"reading {src}")
    z, valid, header, nodata = read_asc(src)
    nrows, ncols = z.shape
    _say(f"grid {nrows}x{ncols}, {int(valid.sum())} valid cells, nodata {nodata:g}")

    eps = float(params.get("epsilon", 1e-5))

    if op == "fill":
        _say(f"priority-flood fill, epsilon {eps:g}")
        filled = fill_depressions(z, valid, eps)
        write_asc(output, filled, valid, header, nodata, integer=False)
    elif op == "flow-direction":
        _say("D8 flow direction")
        fdir = d8_flow_dir(z, valid)
        write_asc(output, fdir, valid, header, nodata, integer=True)
    elif op == "accumulation":
        _say("D8 flow direction")
        fdir = d8_flow_dir(z, valid)
        _say("flow accumulation")
        acc = accumulation(fdir, valid)
        write_asc(output, acc, valid, header, nodata, integer=True)
    elif op == "watershed":
        outlets = params.get("outlets")
        _say("D8 flow direction")
        fdir = d8_flow_dir(z, valid)
        _say(f"watershed labels ({'sinks' if outlets is None else f'{len(outlets)} outlets'})")
        labels = watershed(fdir, valid, outlets)
        write_asc(output, labels, valid, header, nodata, integer=True)
    elif op == "streams":
        if "threshold" not in params:
            raise ToolError("params.threshold (cells) is required for streams")
        threshold = float(params["threshold"])
        _say("D8 flow direction")
        fdir = d8_flow_dir(z, valid)
        _say("flow accumulation")
        acc = accumulation(fdir, valid)
        _say(f"streams at accumulation >= {threshold:g}")
        write_asc(output, stream_grid(acc, threshold), valid, header, nodata, integer=True)
    else:  # all: fill -> d8 -> accumulation; accumulation is the product
        _say(f"priority-flood fill, epsilon {eps:g}")
        filled = fill_depressions(z, valid, eps)
        _say("D8 flow direction")
        fdir = d8_flow_dir(filled, valid)
        _say("flow accumulation")
        acc = accumulation(fdir, valid)
        write_asc(output, acc, valid, header, nodata, integer=True)

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
