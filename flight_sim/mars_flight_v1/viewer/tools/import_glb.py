#!/usr/bin/env python3
"""Turn an exported .glb (or .obj/.stl) into the viewer's per-material STLs.

The viewer loads STL and there is no GLTFLoader vendored, so a Blender export is
split here rather than at runtime. GLB is the format to ask for because it keeps
OBJECT AND MATERIAL SEPARATION, which STL throws away — and that separation is
exactly what the bake needs: a merged STL carries no per-face material, so
anything sharing a file shares a colour in three.js.

There is no quadric-decimation library installed (fast_simplification/open3d are
both absent), so --max-tris uses VERTEX CLUSTERING instead: snap vertices onto a
grid, weld duplicates, drop the faces that collapse. It is cruder than quadric
decimation and softens fine detail, but it is predictable, needs no dependency,
and a ship a few hundred pixels tall does not need the difference.

    python3 tools/import_glb.py ~/Downloads/X-wing.glb --inspect
    python3 tools/import_glb.py ~/Downloads/X-wing.glb --out xfighter --max-tris 6000
"""

import argparse
import os

import numpy as np
import trimesh


def load_scene(path):
    obj = trimesh.load(path, force=None)
    if isinstance(obj, trimesh.Scene):
        return {name: g for name, g in obj.geometry.items() if hasattr(g, "faces")}
    return {"mesh": obj}


def colour_of(mesh):
    """A material's RGB, from PBR base colour or vertex/face colours."""
    vis = getattr(mesh, "visual", None)
    try:
        mat = getattr(vis, "material", None)
        if mat is not None:
            base = getattr(mat, "baseColorFactor", None)
            if base is None:
                base = getattr(mat, "diffuse", None)
            if base is not None:
                return tuple(int(round(c * 255)) if c <= 1 else int(c) for c in base[:3])
        if getattr(vis, "kind", None) == "face":
            return tuple(int(c) for c in vis.face_colors[0][:3])
    except Exception:                                   # noqa: BLE001
        pass
    return None


def cluster_decimate(mesh, target):
    """Vertex-clustering decimation: snap to a grid, weld, drop collapsed faces.

    The grid is chosen by bisection on cell size, because the face count after
    welding is not a simple function of it.
    """
    if len(mesh.faces) <= target:
        return mesh
    lo, hi = mesh.scale / 2000.0, mesh.scale / 4.0
    best = mesh
    for _ in range(24):
        cell = (lo + hi) / 2
        v = np.round(mesh.vertices / cell) * cell
        _, inv = np.unique(v, axis=0, return_inverse=True)
        f = inv[mesh.faces]
        f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
        if len(f) == 0:
            hi = cell
            continue
        cand = trimesh.Trimesh(vertices=np.unique(v, axis=0), faces=f, process=False)
        if len(cand.faces) > target:
            lo = cell                                    # too fine, coarsen
        else:
            best, hi = cand, cell                        # fits, try finer
    return best


def inspect(parts):
    print(f"{'geometry':<38}{'tris':>9}  colour            extents")
    total = 0
    for name, m in sorted(parts.items(), key=lambda kv: -len(kv[1].faces)):
        total += len(m.faces)
        c = colour_of(m)
        print(f"{name[:37]:<38}{len(m.faces):>9}  {str(c):<18}{m.extents.round(1)}")
    print(f"{'TOTAL':<38}{total:>9}")
    print("\nA browser ship wants roughly <10k triangles across all groups.")
    if total > 10000:
        print(f"  -> {total} is over budget; use --max-tris to cluster-decimate.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--out", help="asset basename, e.g. xfighter")
    ap.add_argument("--max-tris", type=int, default=0, help="total triangle budget")
    ap.add_argument("--skip", action="append", default=[], help="substring of geometries to drop")
    ap.add_argument("--forward", choices=["x", "y", "z"], default=None,
                    help="which model axis points forward; it is laid along -Z")
    args = ap.parse_args()

    parts = load_scene(args.src)
    for pat in args.skip:
        for n in [n for n in parts if pat.lower() in n.lower()]:
            del parts[n]
    if args.inspect or not args.out:
        inspect(parts)
        return

    # Group by material colour — that is the split three.js actually needs.
    groups = {}
    for name, m in parts.items():
        key = colour_of(m) or "default"
        groups.setdefault(key, []).append(m)
    merged = {f"g{i}": trimesh.util.concatenate(v) for i, (k, v) in enumerate(groups.items())}
    colours = {f"g{i}": k for i, k in enumerate(groups)}

    total = sum(len(m.faces) for m in merged.values())
    if args.max_tris and total > args.max_tris:
        print(f"decimating {total} -> {args.max_tris} triangles (vertex clustering)")
        for k in merged:
            share = max(24, int(args.max_tris * len(merged[k].faces) / total))
            merged[k] = cluster_decimate(merged[k], share)

    whole = trimesh.util.concatenate(list(merged.values()))
    centre = whole.bounds.mean(0)
    rot = None
    if args.forward:
        ax = "xyz".index(args.forward)
        if ax == 0:
            rot = trimesh.transformations.rotation_matrix(np.radians(90), [0, 1, 0])
        elif ax == 1:
            rot = trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0])

    out_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets"))
    print(f"assembled extents {whole.extents.round(1)}")
    written = 0
    for key, mesh in merged.items():
        baked = mesh.copy()
        baked.apply_translation(-centre)          # SAME centring for every group
        if rot is not None:
            baked.apply_transform(rot)
        path = os.path.join(out_dir, f"{args.out}_{key}.stl")
        baked.export(path, file_type="stl")
        written += len(baked.faces)
        print(f"  {args.out}_{key}.stl  {os.path.getsize(path)/1024:6.0f} KB  "
              f"{len(baked.faces):>6} tris  colour {colours[key]}")
    print(f"  total {written} triangles across {len(merged)} material group(s)")
    print("\nWire these into flightsim.js with one material per group, then check "
          "with tools/preview_mesh.py before shipping.")


if __name__ == "__main__":
    main()
