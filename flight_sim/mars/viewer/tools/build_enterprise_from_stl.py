#!/usr/bin/env python3
"""Bake the starship from EnterpriseSTL.stl (a Blender 3.5 export).

Supersedes build_enterprise_from_obj.py. That source was a 280k-triangle 3ds Max
export whose object names gave a clean material split, but it had to be decimated
~10x to be shippable and the saucer suffered for it. This one arrives at 16,432
triangles — already a sane browser budget — so it ships at FULL RESOLUTION with
no decimation at all, and the surfaces are correspondingly cleaner.

The trade is that a single STL carries no groups whatsoever, so the material
split is rebuilt here from CONNECTED COMPONENTS and their position. That works
because the lit parts of this model are all separate shells:

    bussard domes   +-3.52 outboard, at the FORWARD end of each nacelle
    nacelle caps    +-3.52 outboard, at the AFT end of each nacelle
    deflector dish  on the centreline, below the axis, forward of the hull

There is no impulse-engine shell in this model — the saucer's aft edge is part
of the saucer — so unlike the OBJ bake there is no impulse group.

Axes: the source is Z-up with the ship pointing -Y (saucer at y=-4.91, secondary
hull at +2.18, nacelles at +5.53, and the bussard shells at the nacelles' -Y
end). The viewer flies -Z forward with +Y up, so the mapping is
(x,y,z) <- (-sx, sz, sy); negating x keeps the determinant +1, and without that
the ship comes out mirrored.

    python3 tools/build_enterprise_from_stl.py [~/Downloads/EnterpriseSTL.stl]
"""

import argparse
import os

import numpy as np
import trimesh

TARGET_LENGTH = 26.0        # viewer units — the nominalLength buildStarship uses

# Shells are matched by where their centre sits, in VIEWER axes and relative to
# the model centre. Tolerances are loose because these are well separated.
NACELLE_X = 3.52


def classify(centre, extents, faces):
    """Material group for one connected shell."""
    x, y, z = centre
    outboard = abs(abs(x) - NACELLE_X) < 1.0
    # Glowing domes at the front of each nacelle. The housing RING that sits
    # around them is flat (thin in z) and stays hull-coloured, so require a
    # roughly cubic shell rather than a disc.
    if outboard and z < 2.0 and faces > 400 and extents[2] > 0.8:
        return "bussard"
    # Glowing cap at the back of each nacelle.
    if outboard and z > 8.5 and faces > 100:
        return "caps"
    # Deflector dish: centreline, below the axis, forward of the engineering
    # hull, and DISC-SHAPED. The shape test matters — position alone also catches
    # the housing ring (wider, 1.54), the nose spike (0.12 across) and a few
    # hundred stray detail slivers, and lighting those makes the whole nose glow.
    if (abs(x) < 1.0 and y < -1.0 and z < -2.1 and faces > 300
            and 0.8 < extents[0] < 1.35 and extents[2] < 0.7):
        return "deflector"
    # Mechanical hardware that reads better a shade darker: the deflector
    # housing ring and spike, and the collector rings around the bussards.
    if abs(x) < 1.0 and y < -1.0 and -3.0 < z < -1.5:
        return "trim"
    if outboard and z < 2.0:
        return "trim"
    return "hull"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?",
                    default=os.path.expanduser("~/Downloads/EnterpriseSTL.stl"))
    args = ap.parse_args()

    mesh = trimesh.load(args.src, force="mesh")
    print(f"source: {len(mesh.faces)} tris, extents {mesh.extents.round(2)}")

    # Centre, then rotate into viewer axes. det = +1, so winding is preserved and
    # no invert() is wanted here.
    c = (mesh.bounds[0] + mesh.bounds[1]) / 2
    v = mesh.vertices - c
    mesh.vertices = np.column_stack([-v[:, 0], v[:, 2], v[:, 1]])

    groups = {}
    for shell in mesh.split(only_watertight=False):
        centre = (shell.bounds[0] + shell.bounds[1]) / 2
        key = classify(centre, shell.extents, len(shell.faces))
        groups.setdefault(key, []).append(shell)

    merged = {k: trimesh.util.concatenate(v) for k, v in groups.items()}
    for k in sorted(merged, key=lambda k: -len(merged[k].faces)):
        print(f"  {k:<10} {len(groups[k]):>4} shells  {len(merged[k].faces):>6} tris")

    out_dir = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "assets"))

    print()
    written = 0
    for name in sorted(merged):
        path = os.path.join(out_dir, f"enterprise_{name}.stl")
        merged[name].export(path, file_type="stl")
        written += len(merged[name].faces)
        print(f"  enterprise_{name}.stl  {os.path.getsize(path)/1024:7.0f} KB  "
              f"{len(merged[name].faces):>6} tris")

    whole = trimesh.util.concatenate(list(merged.values()))
    length = whole.extents[2]
    print(f"\nassembled extents {whole.extents.round(2)} "
          f"(span {whole.extents[0]:.2f}, height {whole.extents[1]:.2f}, length {length:.2f})")
    print(f"  -> flightsim.js scale factor {TARGET_LENGTH}/{length:.4f} = "
          f"{TARGET_LENGTH / length:.5f}")
    print(f"  total {written} triangles in {len(merged)} groups (no decimation)")


if __name__ == "__main__":
    main()
