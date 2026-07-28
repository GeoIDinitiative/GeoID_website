#!/usr/bin/env python3
"""Mesh decimation shared by the ship bake tools.

No quadric-decimation library is installed (fast_simplification and open3d are
both absent), so these are vertex-clustering decimators: snap vertices onto a
grid, weld duplicates, drop the faces that collapse. Two grids are offered
because one is not enough — see cylindrical_decimate.
"""

import numpy as np
import trimesh


def cluster_decimate(mesh, target):
    """Grid-snap/weld decimation; no quadric decimator is installed here.

    Bisects on cell size because the face count after welding is not a simple
    function of it. Crude next to quadric decimation, but it holds silhouettes,
    which is what survives at the size this ship is drawn.

    Face count is monotonically DECREASING in cell size, but not continuously:
    on a small dense object it can drop from well above target straight to
    degenerate. So the search keeps a fallback — the sparsest non-degenerate
    result seen — and returns that when no cell size lands under target.
    Without it those objects come back at full resolution.
    """
    if len(mesh.faces) <= target:
        return mesh
    lo, hi = mesh.scale / 6000.0, mesh.scale / 4.0
    under = None                  # best candidate at or below target
    fallback = None               # sparsest non-degenerate candidate seen
    for _ in range(28):
        cell = (lo + hi) / 2
        snapped = np.round(mesh.vertices / cell) * cell
        uniq, inv = np.unique(snapped, axis=0, return_inverse=True)
        f = inv[mesh.faces]
        f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
        if len(f) == 0:
            hi = cell                                  # collapsed: go finer
            continue
        cand = trimesh.Trimesh(vertices=uniq, faces=f, process=False)
        if fallback is None or len(cand.faces) < len(fallback.faces):
            fallback = cand
        if len(cand.faces) > target:
            lo = cell                                  # too fine: go coarser
        else:
            under, hi = cand, cell                     # fits: try finer
    return under if under is not None else (fallback if fallback is not None else mesh)


def revolution_axis(mesh, tol=0.16):
    """Return the axis index this object is a surface of revolution about, else None.

    Bins vertices along a candidate axis and asks whether radius about that axis
    is constant WITHIN each bin. That is exactly the lathe condition, and unlike
    a "is it round" test it accepts the saucer, whose radius varies a lot along
    the axis but is constant around it.
    """
    v = mesh.vertices
    best, best_score = None, tol
    for a in range(3):
        b, c = [i for i in range(3) if i != a]
        centre = v[:, [b, c]].mean(0)
        r = np.hypot(v[:, b] - centre[0], v[:, c] - centre[1])
        if r.max() <= 1e-9:
            continue
        edges = np.linspace(v[:, a].min(), v[:, a].max(), 21)
        idx = np.clip(np.digitize(v[:, a], edges) - 1, 0, 19)
        scores, weights = [], []
        for k in range(20):
            sel = r[idx == k]
            if len(sel) < 8 or sel.mean() < r.max() * 0.02:
                continue
            scores.append(sel.std() / sel.mean())
            weights.append(len(sel))
        if not scores:
            continue
        score = float(np.average(scores, weights=weights))
        if score < best_score:
            best, best_score = a, score
    return best


def cylindrical_decimate(mesh, target, axis):
    """Weld in (theta, r, axial) instead of (x, y, z).

    Cartesian clustering snaps a lathe's rim onto a square grid and it comes back
    visibly ragged — at 10k triangles the saucer edge is already a torn polygon.
    Snapping the ANGLE instead merges whole radial segments, so a ring stays
    exactly circular and only loses sides.
    """
    if len(mesh.faces) <= target:
        return mesh
    b, c = [i for i in range(3) if i != axis]
    v = mesh.vertices
    ctr = v[:, [b, c]].mean(0)
    r = np.hypot(v[:, b] - ctr[0], v[:, c] - ctr[1])
    th = np.arctan2(v[:, c] - ctr[1], v[:, b] - ctr[0])
    ax = v[:, axis]
    span = max(r.max(), np.ptp(ax)) or 1.0

    lo, hi = 1e-4, 0.5
    under, fallback = None, None
    for _ in range(28):
        k = (lo + hi) / 2
        dth = 2 * np.pi * k
        dlin = span * k
        key = np.column_stack([np.round(th / dth), np.round(r / dlin),
                               np.round(ax / dlin)])
        _, inv = np.unique(key, axis=0, return_inverse=True)
        f = inv[mesh.faces]
        f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
        if len(f) == 0:
            hi = k
            continue
        # rebuild positions on the snapped cylinder so rings stay circular
        nth = np.round(th / dth) * dth
        nr = np.round(r / dlin) * dlin
        nax = np.round(ax / dlin) * dlin
        nv = np.empty_like(v)
        nv[:, b] = ctr[0] + nr * np.cos(nth)
        nv[:, c] = ctr[1] + nr * np.sin(nth)
        nv[:, axis] = nax
        uniq_v = np.zeros((inv.max() + 1, 3))
        uniq_v[inv] = nv
        cand = trimesh.Trimesh(vertices=uniq_v, faces=f, process=False)
        if fallback is None or len(cand.faces) < len(fallback.faces):
            fallback = cand
        if len(cand.faces) > target:
            lo = k                                     # too fine: go coarser
        else:
            under, hi = cand, k                        # fits: try finer
    return under if under is not None else (fallback if fallback is not None else mesh)


def decimate_one(mesh, target):
    """Cylindrical decimation for lathed parts, Cartesian for everything else."""
    if len(mesh.faces) <= target:
        return mesh
    axis = revolution_axis(mesh)
    if axis is not None:
        out = cylindrical_decimate(mesh, target, axis)
        if len(out.faces) <= max(target * 1.35, target + 40):
            return out
    return cluster_decimate(mesh, target)


def decimate_group(objs, budget):
    """Decimate each object on its OWN scale, then merge.

    Clustering the merged group instead uses one cell size derived from the
    whole ship's diagonal (~1250 units), which is enormous next to a 9-unit
    bussard element — it welds smooth surfaces into crumpled foil and erases
    small parts outright. Per-object cells, with the budget shared out by
    triangle count, keep both.
    """
    total = sum(len(m.faces) for m in objs)
    out = []
    for m in objs:
        share = max(12, int(round(budget * len(m.faces) / total)))
        out.append(decimate_one(m, share))
    return trimesh.util.concatenate(out)
