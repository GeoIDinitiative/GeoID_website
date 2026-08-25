#!/usr/bin/env python3
"""Bake a browser-safe ship model from a folder of STL parts.

Generalised from tools/build_tardis_stl.py, which was written for one specific
print set. The lessons that tool cost us are baked in here:

  * TRIANGLE COUNT VARIES ENORMOUSLY BY PART. In the TARDIS set the plain wall
    panel was 400 triangles where the fully-detailed door panel was 71k for
    almost the same silhouette. Choosing parts is far more effective than
    decimating them — and no decimation library is installed here anyway
    (trimesh's simplify_quadric_decimation needs fast_simplification/open3d).
    Run --inspect first and pick on triangles-per-silhouette.

  * THE FILE SPLIT MUST FOLLOW THE MATERIAL BOUNDARY, not the logical part.
    A merged STL carries no per-face material, so everything in one file gets a
    single material in three.js. Window mullions bundled with the lit glass took
    the glass's emissive yellow and became invisible. Use --group to split.

  * CHECK WHETHER THE PARTS ARE ASSEMBLED OR BED-LAID BEFORE ANYTHING ELSE.
    The TARDIS set happened to be pre-positioned, which made assembly free — but
    that is the exception. The test is NOT that origins differ (a bed layout also
    tiles parts across x/y); it is whether every part's minimum along one axis
    sits at ~0, i.e. they all rest on the same plane. --inspect reports this.
    A bed layout needs each part rotated and placed by hand from the kit's
    instructions, which is rarely worth it — ask for an assembled single file.

Typical use:
    python3 tools/build_ship_stl.py ~/Downloads/xwing --inspect
    python3 tools/build_ship_stl.py ~/Downloads/xwing --out xfighter \\
        --group body:hull,wing --group glow:engine,thruster --forward
"""

import argparse
import glob
import os
import sys

import numpy as np
import trimesh


def load_parts(src):
    files = sorted(glob.glob(os.path.join(src, "*.stl")))
    if not files:
        sys.exit(f"no .stl files in {src}")
    out = {}
    for f in files:
        try:
            out[os.path.basename(f)] = trimesh.load(f, force="mesh")
        except Exception as exc:                      # noqa: BLE001
            print(f"  !! {os.path.basename(f)}: {exc}")
    return out


def inspect(parts):
    print(f"{'part':<52}{'tris':>9}   extents (x, y, z)          origin")
    total = 0
    for name, m in sorted(parts.items(), key=lambda kv: -len(kv[1].faces)):
        total += len(m.faces)
        e, lo = m.extents, m.bounds[0]
        print(f"{name:<52}{len(m.faces):>9}   "
              f"{e[0]:7.1f}{e[1]:7.1f}{e[2]:7.1f}   "
              f"{lo[0]:7.1f}{lo[1]:7.1f}{lo[2]:7.1f}")
    print(f"{'TOTAL':<52}{total:>9}")
    print("\nA browser ship wants roughly <10k triangles. Pick parts by "
          "silhouette-per-triangle; drop anything whose detail is invisible at "
          "flight scale (carved lettering, threads, internal structure).")
    # Pre-positioned for assembly, or laid out on a print bed?
    #
    # Differing origins are NOT the test — a bed layout also tiles parts across
    # x/y. The giveaway is that a bed layout rests EVERY part on the same plane,
    # so their minima along one axis all sit at ~0. An assembled model has parts
    # at many different heights.
    mins = np.array([m.bounds[0] for m in parts.values()])
    on_plane = [(np.abs(mins[:, ax]) < 0.02).sum() for ax in range(3)]
    best = int(np.argmax(on_plane))
    n, total = on_plane[best], len(parts)
    if n >= max(3, total * 0.7):
        print(f"\nparts are laid out FLAT ON A PRINT BED — {n}/{total} rest at "
              f"{'xyz'[best]}=0. They cannot simply be merged: each needs rotating "
              "and placing per the kit's instructions. Prefer a single "
              "pre-assembled model file if you have one.")
    else:
        print(f"\nparts appear PRE-POSITIONED for assembly ({n}/{total} on any one "
              "plane) — they can be merged as-is.")


def orient(mesh, forward):
    """Centre on the origin; optionally lay the longest axis along -Z."""
    mesh = mesh.copy()
    mesh.apply_translation(-mesh.bounds.mean(0))
    if forward:
        e = mesh.extents
        if e[0] >= e[1] and e[0] >= e[2]:       # X longest -> Z
            mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(90), [0, 1, 0]))
        elif e[1] >= e[2]:                       # Y longest -> Z
            mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0]))
    else:
        # Print sets are Z-up; three.js is Y-up.
        mesh.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0]))
    return mesh


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--inspect", action="store_true", help="list parts and exit")
    ap.add_argument("--out", help="output basename, e.g. xfighter")
    ap.add_argument("--group", action="append", default=[],
                    help="NAME:substr,substr — one output file per material group")
    ap.add_argument("--skip", action="append", default=[], help="substring of parts to drop")
    ap.add_argument("--forward", action="store_true",
                    help="lay the longest axis along -Z (spacecraft); default is Z-up -> Y-up")
    args = ap.parse_args()

    parts = load_parts(args.src)
    if args.inspect or not args.out:
        inspect(parts)
        return

    for pat in args.skip:
        for name in [n for n in parts if pat.lower() in n.lower()]:
            del parts[name]

    groups = {}
    for spec in args.group:
        gname, _, pats = spec.partition(":")
        groups[gname] = [p.strip().lower() for p in pats.split(",") if p.strip()]
    if not groups:
        groups = {"body": []}                     # everything in one file

    # Assemble each group, then apply ONE shared transform so the pieces cannot
    # drift apart — the police-box windows did exactly that when transformed
    # independently.
    assembled = {}
    for gname, pats in groups.items():
        sel = [m for n, m in parts.items()
               if not pats or any(p in n.lower() for p in pats)]
        if sel:
            assembled[gname] = trimesh.util.concatenate(sel)
    if not assembled:
        sys.exit("no parts matched any --group")

    whole = trimesh.util.concatenate(list(assembled.values()))
    centre = whole.bounds.mean(0)
    probe = orient(whole, args.forward)
    scale_note = probe.extents

    out_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets"))
    print(f"assembled extents {whole.extents.round(1)} -> oriented {scale_note.round(1)}")
    total = 0
    for gname, mesh in assembled.items():
        baked = mesh.copy()
        baked.apply_translation(-centre)          # SAME centring for every group
        baked = orient(baked, args.forward) if False else baked
        # orient() re-centres, so do the rotation only, using the shared centre
        if args.forward:
            e = whole.extents
            if e[0] >= e[1] and e[0] >= e[2]:
                baked.apply_transform(trimesh.transformations.rotation_matrix(np.radians(90), [0, 1, 0]))
            elif e[1] >= e[2]:
                baked.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0]))
        else:
            baked.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0]))
        path = os.path.join(out_dir, f"{args.out}_{gname}.stl")
        baked.export(path, file_type="stl")
        total += len(baked.faces)
        print(f"  {args.out}_{gname}.stl  {os.path.getsize(path) / 1024:6.0f} KB  "
              f"{len(baked.faces):>6} tris  extents {baked.extents.round(2)}")
    print(f"  total {total} triangles"
          + ("   ** over ~10k, consider dropping detailed parts **" if total > 10000 else ""))


if __name__ == "__main__":
    main()
