#!/usr/bin/env python3
"""Bake the X-Fighter from the supplied X-wing.blend, split by material slot.

Supersedes build_xfighter_stl.py, which approximated the ship from primitives
measured off a print kit. This uses the real mesh: tools/blend_reader.py walks
the .blend directly (Blender is not installed and bpy has no wheel here), so the
model keeps its own panelling and its author's material assignment instead of a
hand-guessed one — which is what "lacks colour and detail" was about.

Axes: the .blend is Z-up with the nose at +X (verified by slicing — span is 0.9
at the +X end and 3.7 at the -X end where the four nacelles sit). The viewer
flies -Z forward with +Y up, so the mapping is (x,y,z) <- (-by, bz, -bx). That
is right-handed; using (+by, bz, -bx) mirrors the ship.

    python3 tools/build_xfighter_from_blend.py ~/Downloads/X-wing.blend
"""

import argparse
import os
import sys

import numpy as np
import trimesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blend_reader import Blend, mesh_materials, read_mesh   # noqa: E402

MESH_NAME = "JethroXV"
TARGET_LENGTH = 17.0          # viewer units, matching the other ships

# material slot name fragment -> asset group. The slot ORDER is not stable
# across edits of the .blend, so match on the name.
SLOT_GROUP = {
    "Wings": "wings",
    "Glass": "canopy",
    "Parts": "trim",
    "MI_Jethro_XV_4": "hull",
}


def to_viewer_axes(v):
    """Blender (Z-up, nose +X) -> viewer (Y-up, nose -Z), right-handed."""
    return np.column_stack([-v[:, 1], v[:, 2], -v[:, 0]])


def cluster_decimate(mesh, target):
    """Grid-snap/weld decimation; no quadric decimator is installed."""
    if len(mesh.faces) <= target:
        return mesh
    lo, hi = mesh.scale / 4000.0, mesh.scale / 8.0
    best = mesh
    for _ in range(26):
        cell = (lo + hi) / 2
        snapped = np.round(mesh.vertices / cell) * cell
        uniq, inv = np.unique(snapped, axis=0, return_inverse=True)
        f = inv[mesh.faces]
        f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
        if len(f) == 0:
            hi = cell
            continue
        cand = trimesh.Trimesh(vertices=uniq, faces=f, process=False)
        if len(cand.faces) > target:
            lo = cell
        else:
            best, hi = cand, cell
    return best


def group_for(slot_name):
    for frag, grp in SLOT_GROUP.items():
        if frag.lower() in slot_name.lower():
            return grp
    return "hull"


def strip_landing_gear(mesh, floor):
    """Drop shells lying entirely below the hull floor — the gear is modelled DOWN.

    The .blend has it deployed, which is wrong for a ship in flight. Selecting by
    "bounding box entirely below the fuselage underside" rather than by a vertex
    count keeps the criterion geometric: the three legs (two main at x=+-1.2 aft,
    one nose leg on the centreline) are the only shells that qualify.
    """
    comps = mesh.split(only_watertight=False)
    keep = [c for c in comps if c.bounds[1][1] >= floor]
    dropped = len(comps) - len(keep)
    if not keep:
        return mesh, 0, 0
    out = trimesh.util.concatenate(keep)
    return out, dropped, len(mesh.faces) - len(out.faces)


def nacelle_centres(meshes, band=0.25):
    """Find the four engine exhausts: rear-most geometry, split into quadrants."""
    v = np.vstack([m.vertices for m in meshes])
    rear = v[v[:, 2] > v[:, 2].max() - band]
    if len(rear) < 40:
        return []
    y_split = (rear[:, 1].min() + rear[:, 1].max()) / 2
    out = []
    for sx in (-1, 1):
        for hi in (False, True):
            q = rear[((rear[:, 0] >= 0) == (sx > 0)) & ((rear[:, 1] > y_split) == hi)]
            if len(q) < 20:
                continue
            c = q.mean(0)
            r = float(np.median(np.linalg.norm(q[:, :2] - c[:2], axis=1)))
            out.append((c, r))
    return out


def split_accent(wings):
    """Move the squadron markings out of `wings` into their own material group.

    The authentic paint is in T_JethroXV_*_D.png, which the .blend only
    REFERENCES (C:\\Users\\RAFA\\...) and never packed, so the texture is not
    recoverable here and the ship would otherwise fly as one flat grey mass.
    Rather than lay decals over the hull — which z-fight on a curved surface —
    this REASSIGNS existing faces, so the marking is exactly the skin.

    The wing panels are a handful of huge quads, so selecting whole faces would
    swallow the entire panel. They are CUT with slice planes rather than
    subdivided — subdividing them fine enough for a crisp stripe took the wings
    group from 19k to 47k triangles, while slicing adds only the cut edge.
    """
    c = wings.triangles_center
    ax = np.abs(c[:, 0])
    z = c[:, 2]

    # Nacelle collars: a ring on each of the four engine housings. These are
    # dense enough already, so whole-face selection is clean here.
    ring = (ax > 0.7) & (ax < 2.2) & (z > 2.35) & (z < 2.95)
    panel = (ax >= 2.2) & (ax <= 4.9)     # wing skin, outboard of the nacelles

    accent = [wings.submesh([np.where(ring)[0]], append=True)] if ring.any() else []
    rest = np.where(~(ring | panel))[0]
    base = [wings.submesh([rest], append=True)] if len(rest) else []

    if panel.any():
        pm = wings.submesh([np.where(panel)[0]], append=True)
        # cut into 5 slabs across the span; the 2nd and 4th are the stripes
        edges = [-3.25, -2.55, 2.55, 3.25]
        slabs = []
        remaining = pm
        for e in edges:
            lo = trimesh.intersections.slice_mesh_plane(
                remaining, plane_normal=[-1, 0, 0], plane_origin=[e, 0, 0], cap=False)
            remaining = trimesh.intersections.slice_mesh_plane(
                remaining, plane_normal=[1, 0, 0], plane_origin=[e, 0, 0], cap=False)
            slabs.append(lo)
        slabs.append(remaining)
        for i, s in enumerate(slabs):
            if s is None or len(s.faces) == 0:
                continue
            (accent if i in (1, 3) else base).append(s)

    return (trimesh.util.concatenate(base),
            trimesh.util.concatenate(accent) if accent else None)


def build_glow(meshes):
    """Emissive discs recessed into each nacelle — the mesh has no emissive slot."""
    discs = []
    for c, r in nacelle_centres(meshes):
        d = trimesh.creation.cylinder(radius=max(r * 0.80, 0.05), height=0.06, sections=20)
        d.apply_translation([c[0], c[1], c[2] - 0.05])
        discs.append(d)
    return trimesh.util.concatenate(discs) if discs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?", default=os.path.expanduser("~/Downloads/X-wing.blend"))
    ap.add_argument("--max-tris", type=int, default=0, help="0 keeps full resolution")
    ap.add_argument("--keep-gear", action="store_true", help="leave the landing gear deployed")
    ap.add_argument("--no-accent", action="store_true", help="skip the red squadron markings")
    args = ap.parse_args()

    bf = Blend(args.src)
    blk = next(b for b in bf.blocks
               if b["code"] == b"ME\0\0" and bf.name_of(b).startswith(MESH_NAME))
    slots = mesh_materials(bf, blk)
    verts, tris, tmat = read_mesh(bf, blk)
    print(f"{bf.name_of(blk)}: {len(verts)} verts, {len(tris)} tris, slots {slots}")

    verts = to_viewer_axes(verts)
    centre = (verts.min(0) + verts.max(0)) / 2
    verts = verts - centre

    groups = {}
    for i, slot in enumerate(slots):
        sel = tris[tmat == i]
        if len(sel) == 0:
            continue
        g = group_for(slot)
        m = trimesh.Trimesh(vertices=verts, faces=sel, process=False)
        m.remove_unreferenced_vertices()
        groups.setdefault(g, []).append(m)
        print(f"  slot {i} {slot:<34} -> {g:<7} {len(sel):>6} tris")
    groups = {k: (v[0] if len(v) == 1 else trimesh.util.concatenate(v))
              for k, v in groups.items()}

    if not args.keep_gear and "hull" in groups and "trim" in groups:
        floor = groups["hull"].bounds[0][1] - 0.02
        groups["trim"], nshell, ntri = strip_landing_gear(groups["trim"], floor)
        print(f"  gear-up: dropped {nshell} shells / {ntri} tris below y={floor:.2f}")

    if not args.no_accent and "wings" in groups:
        base, accent = split_accent(groups["wings"])
        if accent is not None:
            groups["wings"], groups["accent"] = base, accent
            print(f"  accent: {len(accent.faces)} tris moved out of wings")

    glow = build_glow(list(groups.values()))
    if glow is not None:
        groups["glow"] = glow
        print(f"  glow: {len(nacelle_centres(list(groups.values())))} exhaust discs")

    total = sum(len(m.faces) for m in groups.values())
    if args.max_tris and total > args.max_tris:
        print(f"decimating {total} -> {args.max_tris}")
        for k in list(groups):
            share = max(24, int(args.max_tris * len(groups[k].faces) / total))
            groups[k] = cluster_decimate(groups[k], share)

    whole = trimesh.util.concatenate(list(groups.values()))
    length = whole.extents[2]
    scale = TARGET_LENGTH / length
    print(f"assembled extents {whole.extents.round(2)} "
          f"(span {whole.extents[0]:.2f}, height {whole.extents[1]:.2f}, length {length:.2f})")
    print(f"  -> flightsim.js scale factor {TARGET_LENGTH}/{length:.3f} = {scale:.5f}")

    out_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets"))
    written = 0
    for name, mesh in sorted(groups.items()):
        path = os.path.join(out_dir, f"xfighter_{name}.stl")
        mesh.export(path, file_type="stl")
        written += len(mesh.faces)
        print(f"  xfighter_{name}.stl  {os.path.getsize(path)/1024:7.0f} KB  {len(mesh.faces):>6} tris")
    print(f"  total {written} triangles in {len(groups)} groups")


if __name__ == "__main__":
    main()
