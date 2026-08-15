#!/usr/bin/env python3
"""smooth — 3×3 mean filter over an ESRI ASCII grid.

The demo tool for the sidecar's /jobs/tool route, and the reference for how a
tool script behaves. The contract (the sidecar and every tool must agree):

- ONE JSON object arrives on stdin:
      {"params": {...}, "inputs": ["<abs path>", ...], "output": "<abs path>"}
  The paths are already absolute — the sidecar resolved them through its /fs
  sandbox. A tool never resolves project-relative paths itself.
- Progress goes to stdout a line at a time; it streams into the job log.
- On success the result file(s) are written to `output` and the exit code is
  0. On any failure the exit code is nonzero and the LAST line printed is
  "ERROR: <reason>" — the hub shows that line, so it must say what to do.

This tool reads inputs[0] as an ESRI ASCII grid (.asc), applies a 3×3 mean
filter params.passes times (default 1) and writes the smoothed grid to
output. Edge cells average the neighbours that exist; NODATA cells stay
NODATA and never contaminate a neighbour's mean.

numpy-gated: the filter is a stencil over the whole grid, which is numpy's
job — without it this refuses with a clear ERROR rather than crawling a
large raster in pure Python.
"""

import json
import os
import sys


def fail(reason: str):
    print(f"ERROR: {reason}")
    raise SystemExit(1)


HEADER_KEYS = ("ncols", "nrows", "xllcorner", "yllcorner", "xllcenter",
               "yllcenter", "cellsize", "nodata_value")


def read_asc(path: str):
    """(header dict, flat list of floats) from an ESRI ASCII grid."""
    header: dict[str, float] = {}
    values: list[float] = []
    with open(path) as fh:
        for line in fh:
            parts = line.split()
            if not parts:
                continue
            key = parts[0].lower()
            # Header lines lead; the first non-header line starts the data,
            # and rows may wrap, so everything after is one stream of values.
            if not values and key in HEADER_KEYS and len(parts) == 2:
                header[key] = float(parts[1])
            else:
                try:
                    values.extend(float(v) for v in parts)
                except ValueError:
                    fail(f"not an ESRI ASCII grid (bad value {parts[0]!r}): {path}")
    for need in ("ncols", "nrows", "cellsize"):
        if need not in header:
            fail(f"not an ESRI ASCII grid (missing {need}): {path}")
    ncols, nrows = int(header["ncols"]), int(header["nrows"])
    if len(values) != ncols * nrows:
        fail(f"grid holds {len(values)} values, header promises {ncols * nrows}")
    return header, values


def main() -> int:
    try:
        spec = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        fail(f"stdin must be one JSON object: {exc}")
    inputs = spec.get("inputs") or []
    output = spec.get("output") or ""
    params = spec.get("params") or {}
    if not inputs:
        fail("smooth needs one input grid (inputs[0], an .asc file)")
    if not output:
        fail("smooth needs an output path")
    try:
        import numpy as np
    except ImportError:
        fail("numpy is not installed — smooth needs it (pip install numpy)")

    src = inputs[0]
    if not os.path.isfile(src):
        fail(f"no such input: {src}")
    header, values = read_asc(src)
    ncols, nrows = int(header["ncols"]), int(header["nrows"])
    nodata = header.get("nodata_value")
    passes = max(1, min(int(params.get("passes", 1) or 1), 64))
    grid = np.asarray(values, dtype=float).reshape(nrows, ncols)
    print(f"[smooth] {ncols}x{nrows} grid from {os.path.basename(src)}, "
          f"{passes} pass(es)")

    # NODATA is a mask, not a value: a masked cell contributes nothing to any
    # mean and keeps its own value, so holes neither spread nor shrink.
    mask = np.ones((nrows, ncols), dtype=bool) if nodata is None \
        else grid != nodata
    for n in range(passes):
        vals = np.where(mask, grid, 0.0)
        padded_vals = np.pad(vals, 1)
        padded_mask = np.pad(mask.astype(float), 1)
        total = np.zeros_like(vals)
        count = np.zeros_like(vals)
        # The zero padding makes the edge behaviour explicit: out-of-grid
        # cells add nothing to total and nothing to count, so an edge cell is
        # the mean of the neighbours it actually has.
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                total += padded_vals[dy:dy + nrows, dx:dx + ncols]
                count += padded_mask[dy:dy + nrows, dx:dx + ncols]
        grid = np.where(mask, total / np.maximum(count, 1.0), grid)
        print(f"[smooth] pass {n + 1}/{passes} done")

    lines = [f"ncols {ncols}", f"nrows {nrows}"]
    for key in ("xllcorner", "xllcenter", "yllcorner", "yllcenter", "cellsize"):
        if key in header:
            lines.append(f"{key} {header[key]:g}")
    if nodata is not None:
        lines.append(f"NODATA_value {nodata:g}")
    for row in grid:
        lines.append(" ".join(f"{v:g}" for v in row))
    with open(output, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"[smooth] wrote {output} ({ncols}x{nrows})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
