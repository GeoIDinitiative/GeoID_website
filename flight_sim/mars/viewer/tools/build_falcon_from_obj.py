#!/usr/bin/env python3
"""Bake the Millennium Falcon from a Blender-exported OBJ.

The source ("sokol mile.blend") carries NO usable material information: its .mtl
was not shipped alongside the .obj, and the usemtl names that survive are "None"
and "None_fajna_textura.jpg" with 89% of faces on plain "None". So unlike the
Enterprise bake — where object names at least mapped to parts — everything here
is grouped by OBJECT SPLIT and position.

What the split does give us is a separation between the smooth plating and the
greebling, and that is enough for a believable two-tone hull. Be careful which
is which: the object with 229k triangles is the GREEBLING, and the one with 21k
is the plating (see the note on HULL_OBJS below).

Axes: the source is Y-up pointing +Z. Front was verified from the geometry, not
assumed — at the +Z end the x-histogram splits into two lobes with a gap at the
centreline (the mandible fork), while the -Z end is a solid wide block carrying
the engine vent. The viewer flies -Z forward, so this turns 180 deg about Y.

    python3 tools/build_falcon_from_obj.py [~/Downloads/1.obj]
"""

import argparse
import os
import sys

import numpy as np
import trimesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_util import decimate_group   # noqa: E402

TARGET_LENGTH = 20.0        # viewer units; X-Fighter is 17, Enterprise 26

BUDGET = {
    "hull": 14000,
    "trim": 20000,
    "engine": 400,
}

# WHICH LAYER IS WHICH is not what the triangle counts suggest. The 229k-triangle
# object is the GREEBLING — all the little boxes and pipes — and covers only 14.2
# units of area, while the 21k object carries 25.4 units and is the smooth disc,
# mandible and ring plating. Rendered on their own the big one is a hollow
# filigree and the small one is the actual ship. So the greebles get the darker
# material and the bulk of the triangle budget, and the plating stays hull.
ENGINE_OBJ = "Cube.372_Cube.443_5"          # rear exhaust vent, 1.87 wide, 0.13 tall
HULL_OBJS = {
    "Cube.372_Cube.443_6",                  # smooth plating: disc, mandibles, ring
    "Cube.372_Cube.443_2",                  # cockpit tube and pod
}


def classify(name):
    if name == ENGINE_OBJ:
        return "engine"
    if name in HULL_OBJS:
        return "hull"
    return "trim"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default=os.path.expanduser("~/Downloads/1.obj"))
    ap.add_argument("--full", action="store_true", help="skip decimation")
    args = ap.parse_args()

    scene = trimesh.load(args.src, split_object=True, group_material=False,
                         skip_materials=True, process=False)
    parts = scene.geometry
    allv = np.vstack([m.vertices for m in parts.values()])
    centre = (allv.min(0) + allv.max(0)) / 2
    print(f"{len(parts)} objects, {sum(len(m.faces) for m in parts.values())} tris, "
          f"extents {(allv.max(0) - allv.min(0)).round(2)}")

    flip = np.diag([-1.0, 1.0, -1.0])      # 180 deg about Y: nose to -Z

    groups = {}
    for name, mesh in parts.items():
        m = mesh.copy()
        m.apply_translation(-centre)       # SAME centring for every group
        # det(flip) = +1 — a proper rotation, so winding survives untouched.
        m.vertices = m.vertices @ flip
        groups.setdefault(classify(name), []).append(m)

    for name in sorted(groups, key=lambda k: -sum(len(m.faces) for m in groups[k])):
        n = sum(len(m.faces) for m in groups[name])
        print(f"  {name:<8} {len(groups[name]):>2} objs  {n:>7} tris")

    out_dir = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "assets"))

    print()
    written = 0
    for name in sorted(groups):
        objs = groups[name]
        mesh = (trimesh.util.concatenate(objs) if args.full
                else decimate_group(objs, BUDGET.get(name, 3000)))
        path = os.path.join(out_dir, f"falcon_{name}.stl")
        mesh.export(path, file_type="stl")
        written += len(mesh.faces)
        print(f"  falcon_{name}.stl  {os.path.getsize(path)/1024:7.0f} KB  "
              f"{len(mesh.faces):>6} tris")

    whole = trimesh.util.concatenate(
        [trimesh.load(os.path.join(out_dir, f"falcon_{n}.stl"), force="mesh")
         for n in sorted(groups)])
    length = whole.extents[2]
    print(f"\nassembled extents {whole.extents.round(2)} "
          f"(span {whole.extents[0]:.2f}, height {whole.extents[1]:.2f}, length {length:.2f})")
    print(f"  -> flightsim.js scale factor {TARGET_LENGTH}/{length:.4f} = "
          f"{TARGET_LENGTH / length:.5f}")
    print(f"  total {written} triangles in {len(groups)} groups")


if __name__ == "__main__":
    main()
