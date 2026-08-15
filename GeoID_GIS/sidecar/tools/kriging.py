#!/usr/bin/env python3
"""
kriging.py — sidecar tool: ordinary kriging of scattered samples onto a grid.

/jobs/tool contract: the sidecar runs `python3 sidecar/tools/kriging.py`
with ONE JSON object on stdin:

    { "params": {...}, "inputs": ["<abs path>", ...], "output": "<abs path>" }

Progress lines go to stdout (they stream into the job log). Exit 0 on
success; nonzero with a final "ERROR: <reason>" line on failure.

TWO GATES, IN THIS ORDER. numpy is required ("ERROR: numpy required"), and
then scipy separately ("ERROR: scipy required") — scipy carries the LU
factorisation, the pairwise distances and the variogram fit, and a machine
with numpy but no scipy must be told which one is missing rather than shown
a traceback about the other.

`inputs` is unused: the samples arrive in params, because the caller has
them as a vector layer's attribute already. `output` is an .asc grid of the
kriged surface.

params
    points        [[x, y, value], ...] — lon/lat and the value to
                  interpolate. Capped at 2000 (see below).
    model         "spherical" (default) or "exponential"
    range_m       the variogram range in metres; fitted when absent
    sill          the variogram sill (the plateau, nugget included);
                  fitted when absent
    nugget        the jump at the origin (default 0). With nugget 0 the
                  predictor is an EXACT interpolator: at a sample location
                  it returns that sample's value.
    cells_across  columns in the output grid (default 256); rows follow
                  from the bounds' aspect ratio
    bounds        [minX, minY, maxX, maxY]; the samples' own extent when
                  absent

DISTANCES ARE METRES. When every coordinate looks geographic
(|x| <= 360 and |y| <= 90) the pair is projected with the local
equirectangular scaling the browser uses — 111320·cos(lat0) metres per
degree of longitude at the centre latitude of the area, 110574 per degree
of latitude — so range_m means what it says. Coordinates outside that range
are taken to be projected metres already and used as they are.

ORDINARY KRIGING. For each grid point the weights w solve

    [ Γ  1 ] [ w ]   [ γ0 ]
    [ 1ᵀ 0 ] [ μ ] = [  1 ]

where Γ_ij = γ(|x_i − x_j|) and γ0_i = γ(|x_i − x0|); the last row is the
unbiasedness constraint Σw = 1, and μ is its Lagrange multiplier. The
left-hand side does not depend on the grid point, so it is LU-factorised
ONCE and every grid point is a back-substitution — the whole grid solves in
blocks of a few thousand right-hand sides. Exactness at the samples falls
straight out of this: at a sample location γ0 is that sample's own column
of Γ, so w is the unit vector and the prediction is the datum.

VARIOGRAM MODELS, with γ(0) = 0 and s = sill − nugget the partial sill:

    spherical    γ(h) = nugget + s·(1.5·h/a − 0.5·(h/a)³),  h ≤ a; sill above
    exponential  γ(h) = nugget + s·(1 − exp(−3h/a))

`a` is range_m. The exponential's factor of 3 is the PRACTICAL range
convention (GSLIB, gstat): γ reaches 95% of the sill at h = a, so the two
models' ranges mean the same thing to a user switching between them.

FITTING range and sill, when either is absent:

 1. Every pair of samples is binned by distance into 15 equal lags out to
    HALF the largest pair distance — past that a lag holds too few pairs,
    and the pairs it does hold are the extremes of the area.
 2. Matheron's estimator per lag: γ̂(h) = ½·mean((z_i − z_j)²).
 3. Method of moments as the starting point: the sill is the mean of γ̂
    over the outer third of the populated lags (the plateau), and the range
    is where γ̂ first reaches 95% of that sill, interpolated linearly
    between lag centres.
 4. Least squares refines it — the model curve against γ̂, weighted by pair
    count (σ = 1/√N, so a well-populated lag pulls harder), with the moment
    estimates as the initial guess and the sill bounded below by the
    nugget. A fit that fails to converge or comes back non-physical is
    discarded and the moment estimates stand; the log line says which of
    the two produced the numbers.

A supplied range_m or sill is never overwritten — only the missing one is
fitted, and both together when both are absent.

THE 2000-POINT CAP is a refusal, not a truncation: Γ is dense and
(N+1)², and a caller who asked for 5000 points and silently got 2000 would
be shown a map of a different dataset. Subsample, or split the area.
"""

import json
import math
import os
import sys

try:
    import numpy as np
except ImportError:  # reported via main()'s contract line, not a traceback
    np = None

try:
    from scipy.linalg import lu_factor, lu_solve
    from scipy.optimize import curve_fit
    from scipy.spatial.distance import cdist, pdist
except ImportError:  # gated AFTER numpy, so the message names the right one
    lu_factor = lu_solve = curve_fit = cdist = pdist = None

MODELS = ("spherical", "exponential")
MAX_POINTS = 2000
MAX_CELLS_ACROSS = 4096
DEFAULT_NODATA = -9999.0


class ToolError(Exception):
    """An expected failure — becomes the job's final ERROR: line."""


# ── ESRI ASCII grid writer (identical to hydrology.py's) ────────────────────

def write_asc(path, grid, valid, header, nodata, integer=False):
    """Write a grid under a header of (key, value-as-written) pairs.

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


# ── variogram ───────────────────────────────────────────────────────────────

def variogram(h, model, rng, sill, nugget=0.0):
    """γ(h) for the named model. γ(0) = 0; `sill` is the plateau, nugget
    included, so the partial sill is sill − nugget."""
    if model not in MODELS:
        raise ToolError(f"params.model must be one of {', '.join(MODELS)}; got {model!r}")
    if rng <= 0:
        raise ToolError("the variogram range must be positive")
    h = np.asarray(h, dtype=np.float64)
    partial = float(sill) - float(nugget)
    if model == "spherical":
        hr = np.minimum(h / rng, 1.0)
        g = nugget + partial * (1.5 * hr - 0.5 * hr ** 3)
    else:  # exponential, practical range: 95% of the sill at h = rng
        g = nugget + partial * (1.0 - np.exp(-3.0 * h / rng))
    return np.where(h <= 0.0, 0.0, g)


def empirical_variogram(xy_m, values, nbins=15):
    """Matheron's estimator on equal-width lags out to half the largest pair
    distance. Returns (lag centres, γ̂, pair counts) for populated lags only.
    """
    d = pdist(xy_m)
    dz = pdist(np.asarray(values, dtype=np.float64).reshape(-1, 1))
    if d.size == 0:
        return np.zeros(0), np.zeros(0), np.zeros(0, dtype=np.int64)
    hmax = float(d.max()) / 2.0
    if hmax <= 0:
        return np.zeros(0), np.zeros(0), np.zeros(0, dtype=np.int64)
    edges = np.linspace(0.0, hmax, nbins + 1)
    keep = (d > 0) & (d <= hmax)
    if not np.any(keep):
        return np.zeros(0), np.zeros(0), np.zeros(0, dtype=np.int64)
    idx = np.clip(np.searchsorted(edges, d[keep], side="left") - 1, 0, nbins - 1)
    counts = np.bincount(idx, minlength=nbins)
    sums = np.bincount(idx, weights=0.5 * dz[keep] ** 2, minlength=nbins)
    centres = 0.5 * (edges[:-1] + edges[1:])
    ok = counts > 0
    return centres[ok], sums[ok] / counts[ok], counts[ok]


def fit_variogram(centres, gamma, counts, model, nugget, sample_variance,
                  rng_given=None, sill_given=None):
    """(range_m, sill, how) — see the module docstring's FITTING section.

    Anything the caller supplied is passed straight back; only the missing
    parameter is estimated.
    """
    if rng_given is not None and sill_given is not None:
        return float(rng_given), float(sill_given), "given"

    if centres.size == 0:
        sill0 = sample_variance if sample_variance > 0 else 1.0
        rng0 = 1.0
        how = "no pairs to fit — sample variance and a unit range"
        rng = float(rng_given) if rng_given is not None else rng0
        sill = float(sill_given) if sill_given is not None else sill0
        return rng, max(sill, nugget + 1e-12), how

    tail = max(1, centres.size // 3)
    sill0 = float(np.mean(gamma[-tail:]))
    if not math.isfinite(sill0) or sill0 <= 0:
        # A flat field has no structure to fit; any positive sill gives the
        # same ordinary-kriging weights, so say so rather than fail.
        sill0 = float(sample_variance) if sample_variance > 0 else 1.0
    target = 0.95 * sill0
    rng0 = float(centres[-1])
    for i in range(centres.size):
        if gamma[i] >= target:
            if i == 0:
                rng0 = float(centres[0])
            else:
                span = gamma[i] - gamma[i - 1]
                frac = 0.0 if span <= 0 else (target - gamma[i - 1]) / span
                rng0 = float(centres[i - 1] + frac * (centres[i] - centres[i - 1]))
            break
    how = "method of moments"

    if curve_fit is not None and centres.size >= 3:
        def curve(h, rng_p, sill_p):
            return variogram(h, model, rng_p, sill_p, nugget)

        try:
            popt, _cov = curve_fit(
                curve, centres, gamma,
                p0=[max(rng0, 1e-9), max(sill0, nugget + 1e-9)],
                sigma=1.0 / np.sqrt(counts), absolute_sigma=False,
                bounds=([1e-9, max(float(nugget), 0.0) + 1e-12], [np.inf, np.inf]),
                maxfev=10000,
            )
            if np.all(np.isfinite(popt)) and popt[0] > 0 and popt[1] > nugget:
                rng0, sill0 = float(popt[0]), float(popt[1])
                how = "least squares"
        except Exception:
            pass  # the moment estimates stand, and `how` still says so

    rng = float(rng_given) if rng_given is not None else rng0
    sill = float(sill_given) if sill_given is not None else sill0
    if sill_given is None:
        sill = max(sill, nugget + 1e-12)
    return rng, sill, how


# ── the solve ───────────────────────────────────────────────────────────────

def ordinary_kriging(xy_m, values, grid_xy_m, model, rng, sill, nugget=0.0,
                     block=2048, say=None):
    """Predicted value at every row of `grid_xy_m`. See the module docstring."""
    n = xy_m.shape[0]
    lhs = np.empty((n + 1, n + 1), dtype=np.float64)
    lhs[:n, :n] = variogram(cdist(xy_m, xy_m), model, rng, sill, nugget)
    lhs[:n, n] = 1.0
    lhs[n, :n] = 1.0
    lhs[n, n] = 0.0
    try:
        factored = lu_factor(lhs)
    except Exception as exc:
        raise ToolError(f"the kriging system could not be factorised: {exc}")

    out = np.empty(grid_xy_m.shape[0], dtype=np.float64)
    for start in range(0, grid_xy_m.shape[0], block):
        pts = grid_xy_m[start:start + block]
        rhs = np.empty((n + 1, pts.shape[0]), dtype=np.float64)
        rhs[:n, :] = variogram(cdist(xy_m, pts), model, rng, sill, nugget)
        rhs[n, :] = 1.0
        weights = lu_solve(factored, rhs)
        out[start:start + pts.shape[0]] = values @ weights[:n, :]
        if say and grid_xy_m.shape[0] > block:
            done = min(start + block, grid_xy_m.shape[0])
            say(f"[kriging] {done} of {grid_xy_m.shape[0]} cells solved")
    if not np.all(np.isfinite(out)):
        raise ToolError(
            "the kriging system is singular — two samples probably share a "
            "location; average the duplicates or set a nugget above zero"
        )
    return out


# ── inputs ──────────────────────────────────────────────────────────────────

def parse_points(raw):
    """(xy float64 [n,2], values float64 [n]) from params.points."""
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ToolError("params.points is required: [[x, y, value], ...]")
    if len(raw) > MAX_POINTS:
        raise ToolError(
            f"{len(raw)} sample points exceeds the {MAX_POINTS}-point cap — "
            f"ordinary kriging factorises a dense ({len(raw)}+1)² matrix and "
            f"solves it for every grid cell; subsample the points or split the area"
        )
    if len(raw) < 2:
        raise ToolError("ordinary kriging needs at least 2 sample points")
    xy = np.empty((len(raw), 2), dtype=np.float64)
    values = np.empty(len(raw), dtype=np.float64)
    for i, row in enumerate(raw):
        try:
            x, y, v = float(row[0]), float(row[1]), float(row[2])
        except (TypeError, ValueError, IndexError):
            raise ToolError(f"points[{i}] is not [x, y, value]: {row!r}")
        if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(v)):
            raise ToolError(f"points[{i}] holds a non-finite number: {row!r}")
        xy[i] = (x, y)
        values[i] = v
    return xy, values


def metre_scale(xy, bounds):
    """(sx, sy, geographic?) — multiply a coordinate by these for metres.

    The same heuristic viewshed.py applies to a grid header: coordinates
    that all fit inside |x| <= 360, |y| <= 90 are degrees, anything else is
    already projected.
    """
    xs = np.concatenate([xy[:, 0], np.asarray([bounds[0], bounds[2]], dtype=np.float64)])
    ys = np.concatenate([xy[:, 1], np.asarray([bounds[1], bounds[3]], dtype=np.float64)])
    geographic = bool(np.all(np.abs(xs) <= 360.0) and np.all(np.abs(ys) <= 90.0))
    if not geographic:
        return 1.0, 1.0, False
    lat0 = max(-89.9, min(89.9, 0.5 * (float(bounds[1]) + float(bounds[3]))))
    return 111320.0 * math.cos(math.radians(lat0)), 110574.0, True


def build_grid(bounds, cells_across):
    """(xs, ys north-first, cellsize, ncols, nrows) covering `bounds`.

    An .asc carries ONE cellsize, so the column count sets it and the north
    edge is snapped to a whole number of rows — up to half a cell from the
    requested maxY, which is what every square-cell raster does.
    """
    minx, miny, maxx, maxy = (float(v) for v in bounds)
    if not (maxx > minx and maxy > miny):
        raise ToolError(
            f"bounds must be [minX, minY, maxX, maxY] with a positive span; got {bounds!r}"
        )
    ncols = int(cells_across)
    if ncols < 2:
        ncols = 2
    if ncols > MAX_CELLS_ACROSS:
        ncols = MAX_CELLS_ACROSS
    cellsize = (maxx - minx) / ncols
    nrows = max(1, int(round((maxy - miny) / cellsize)))
    xs = minx + (np.arange(ncols) + 0.5) * cellsize
    top = miny + nrows * cellsize
    ys = top - (np.arange(nrows) + 0.5) * cellsize  # row 0 = north
    return xs, ys, cellsize, ncols, nrows


# ── job entry point ─────────────────────────────────────────────────────────

def _say(msg):
    print(msg, flush=True)  # flushed so the sidecar's job log streams live


def _optional_number(params, key):
    value = params.get(key)
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise ToolError(f"params.{key} must be a number; got {value!r}")
    if not math.isfinite(out):
        raise ToolError(f"params.{key} must be finite; got {value!r}")
    return out


def _run(job):
    params = job.get("params") or {}
    output = job.get("output")
    if not output:
        raise ToolError("output path is required")

    xy, values = parse_points(params.get("points"))
    model = params.get("model") or "spherical"
    if model not in MODELS:
        raise ToolError(f"params.model must be one of {', '.join(MODELS)}; got {model!r}")
    nugget = _optional_number(params, "nugget") or 0.0
    if nugget < 0:
        raise ToolError("params.nugget cannot be negative")
    rng_given = _optional_number(params, "range_m")
    if rng_given is not None and rng_given <= 0:
        raise ToolError("params.range_m must be positive")
    sill_given = _optional_number(params, "sill")
    if sill_given is not None and sill_given <= nugget:
        raise ToolError("params.sill must be greater than the nugget")
    cells_across = params.get("cells_across")
    try:
        cells_across = 256 if cells_across in (None, "") else int(float(cells_across))
    except (TypeError, ValueError):
        raise ToolError(f"params.cells_across must be a number; got {cells_across!r}")

    bounds = params.get("bounds")
    if bounds is None:
        bounds = [float(xy[:, 0].min()), float(xy[:, 1].min()),
                  float(xy[:, 0].max()), float(xy[:, 1].max())]
        _say(f"[kriging] no bounds given — using the samples' own extent {bounds}")
    if not isinstance(bounds, (list, tuple)) or len(bounds) != 4:
        raise ToolError(f"params.bounds must be [minX, minY, maxX, maxY]; got {bounds!r}")
    try:
        bounds = [float(v) for v in bounds]
    except (TypeError, ValueError):
        raise ToolError(f"params.bounds must hold four numbers; got {bounds!r}")
    if not all(math.isfinite(v) for v in bounds):
        raise ToolError(f"params.bounds must be finite; got {bounds!r}")

    _say(f"[kriging] {xy.shape[0]} samples, model {model}, nugget {nugget:g}")
    sx, sy, geographic = metre_scale(xy, bounds)
    _say(f"[kriging] coordinates read as {'degrees' if geographic else 'projected metres'}"
         + (f" — {sx:.1f} m/deg east, {sy:.1f} m/deg north" if geographic else ""))
    xy_m = np.column_stack([xy[:, 0] * sx, xy[:, 1] * sy])

    if nugget <= 0 and float(pdist(xy_m).min()) <= 0.0:
        raise ToolError(
            "two samples share a location — with nugget 0 the kriging system "
            "is singular; average the duplicates or set a nugget above zero"
        )

    centres, gamma_hat, counts = empirical_variogram(xy_m, values)
    rng, sill, how = fit_variogram(
        centres, gamma_hat, counts, model, nugget,
        float(np.var(values)), rng_given, sill_given,
    )
    _say(f"[kriging] variogram {model}: range {rng:.4g} m, sill {sill:.4g} "
         f"({how}, {centres.size} populated lags)")

    xs, ys, cellsize, ncols, nrows = build_grid(bounds, cells_across)
    _say(f"[kriging] grid {ncols}x{nrows}, cell {cellsize:.6g} "
         f"({'degrees' if geographic else 'units'})")
    gx, gy = np.meshgrid(xs, ys, indexing="xy")
    grid_xy_m = np.column_stack([gx.ravel() * sx, gy.ravel() * sy])

    predicted = ordinary_kriging(xy_m, values, grid_xy_m, model, rng, sill,
                                 nugget, say=_say)
    grid = predicted.reshape(nrows, ncols)
    _say(f"[kriging] predicted {grid.size} cells, range {grid.min():.6g} "
         f"to {grid.max():.6g} (samples {values.min():.6g} to {values.max():.6g})")

    header = [
        ("ncols", str(ncols)),
        ("nrows", str(nrows)),
        ("xllcorner", format(float(bounds[0]), ".10g")),
        ("yllcorner", format(float(bounds[1]), ".10g")),
        ("cellsize", format(cellsize, ".10g")),
        ("NODATA_value", format(DEFAULT_NODATA, ".10g")),
    ]
    write_asc(output, grid, np.ones_like(grid, dtype=bool), header, DEFAULT_NODATA)
    _say(f"wrote {output}")
    return 0


def main():
    if np is None:
        print("ERROR: numpy required", flush=True)
        return 1
    if lu_factor is None:
        print("ERROR: scipy required", flush=True)
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
