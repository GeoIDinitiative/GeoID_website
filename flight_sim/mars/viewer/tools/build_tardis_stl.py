#!/usr/bin/env python3
"""Bake the flight sim's police-box model from the modular-TARDIS print set.

Three hand-built procedural versions of this box were rejected before we gave up
guessing and took the shape from the real thing. The recurring failure was the
roof: it is a stack of shallow overhanging STEPS, and neither a four-tier taper
nor a hipped pyramid reads correctly at a glance.

The print set is ~100 MB and 164k triangles for ONE of its three sizes, which is
a non-starter in a browser. It is also modular, so the useful property is that
the parts are already positioned in ASSEMBLY coordinates (Z up, base at z=0,
lamp finial at z=143.5) rather than laid out flat for printing — the walls just
need replicating around the vertical axis.

Only the low-poly parts are used. The plain wall panel is 400 triangles where the
fully-detailed door panel is 71k, and the carved sign and lamp are 10k and 25k;
those three are drawn procedurally in flightsim.js instead, because they are a
few pixels tall in flight and their geometry cost is entirely wasted.

Output (written into assets/, ~425 KB and 8.7k triangles total):
    tardis_body.stl     base + 4 walls + upper ring + stepped top
    tardis_windows.stl  8 windows, kept separate so they can take a lit material

Usage:  python3 tools/build_tardis_stl.py /path/to/modular-tardis-model_files
"""

import os
import sys

import numpy as np
import trimesh

# Parts chosen for silhouette-per-triangle. "S" is the smallest of the three
# size variants in the set; they are the same shape, so the cheapest wins.
PARTS = {
    "base": "S - Base.1.blue.stl",                                    # 1150 tris
    "panel": "S - Panel.3.blue.stl",                                  #  400
    "ring": "S - UpperRing.1.blue.stl",                               #  384
    "top": "S - Top.1.blue.stl",                                      # 3488, the stepped roof
    "window": "S - Window.8.white.stl",                               #  240, mullion frame
}


def rot_z(mesh, degrees):
    out = mesh.copy()
    out.apply_transform(trimesh.transformations.rotation_matrix(np.radians(degrees), [0, 0, 1]))
    return out


def main(src_dir, out_dir):
    part = {k: trimesh.load(os.path.join(src_dir, v), force="mesh") for k, v in PARTS.items()}

    # The kit ships one door panel and three plain ones; we use the plain panel
    # on all four faces, since the door detail is invisible at flight scale.
    walls = [rot_z(part["panel"], a) for a in (0, 90, 180, 270)]
    body = trimesh.util.concatenate([part["base"], part["ring"], part["top"], *walls])

    # WINDOWS ARE BUILT HERE, not taken from the kit. The kit's window part has
    # 2 vertical bars but only ONE horizontal, i.e. 3 columns x 2 rows, while the
    # reference has 2 vertical and 3 horizontal gridlines -> 3 columns x 4 rows.
    # Building it explicitly also lets the backing sit on the INNER face: putting
    # it on the outer side hid the bars completely and the window read as a plain
    # lit rectangle.
    ref = part["window"]
    lo, hi = ref.bounds
    x0, x1 = lo[0], hi[0]
    z0, z1 = lo[2], hi[2]
    y_out, y_in = lo[1], hi[1]          # outer face is the more negative y
    BAR, BORDER = 0.55, 0.75

    def bar(cx, cz, w, h, y_lo, y_hi):
        b = trimesh.creation.box(extents=[w, y_hi - y_lo, h])
        b.apply_translation([cx, (y_lo + y_hi) / 2, cz])
        return b

    # THE GRID GOES IN THE BODY MESH, NOT THE WINDOW MESH. Both meshes get one
    # material each, so bars bundled with the lit backing took the same glowing
    # yellow and vanished against it. In the body mesh they take the box's blue
    # and read as gridlines over the light.
    def window_pane(flip):
        """Lit backing only — inner face, so the bars in front of it show."""
        px0, px1 = (-x1, -x0) if flip else (x0, x1)
        return bar((px0 + px1) / 2, (z0 + z1) / 2, px1 - px0, z1 - z0, y_in - 0.6, y_in)

    def window_grid(flip):
        """Frame + mullions, on the outer face."""
        px0, px1 = (-x1, -x0) if flip else (x0, x1)
        w, h = px1 - px0, z1 - z0
        cx, cz = (px0 + px1) / 2, (z0 + z1) / 2
        parts = [
            bar(cx, z0 + BORDER / 2, w, BORDER, y_out, y_out + 0.7),
            bar(cx, z1 - BORDER / 2, w, BORDER, y_out, y_out + 0.7),
            bar(px0 + BORDER / 2, cz, BORDER, h, y_out, y_out + 0.7),
            bar(px1 - BORDER / 2, cz, BORDER, h, y_out, y_out + 0.7),
        ]
        # 3 COLUMNS x 2 ROWS of panes -> 2 vertical gridlines, 1 horizontal.
        # Note the counts are the transpose of the pane counts: N panes across
        # needs N-1 gridlines. Getting this backwards produced a 2x3 window.
        for i in (1, 2):
            parts.append(bar(px0 + w * i / 3, cz, BAR, h, y_out, y_out + 0.7))
        parts.append(bar(cx, z0 + h / 2, w, BAR, y_out, y_out + 0.7))
        return trimesh.util.concatenate(parts)

    pane_pair = trimesh.util.concatenate([window_pane(False), window_pane(True)])
    grid_pair = trimesh.util.concatenate([window_grid(False), window_grid(True)])
    windows = trimesh.util.concatenate([rot_z(pane_pair, a) for a in (0, 90, 180, 270)])
    body = trimesh.util.concatenate([body] + [rot_z(grid_pair, a) for a in (0, 90, 180, 270)])

    whole = trimesh.util.concatenate([body, windows])
    cx, cy = whole.bounds[:, 0].mean(), whole.bounds[:, 1].mean()
    zmin, zmax = whole.bounds[0][2], whole.bounds[1][2]

    # Centre on the origin and convert the print set's Z-up to three.js's Y-up.
    # Both meshes get the SAME transform or the windows drift off the walls.
    transform = trimesh.transformations.concatenate_matrices(
        trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0]),
        trimesh.transformations.translation_matrix([-cx, -cy, -(zmin + zmax) / 2]),
    )

    print(f"assembled height {zmax - zmin:.1f}, h:w {(zmax - zmin) / whole.extents[0]:.2f}")
    # Report the window grid explicitly — triangle count alone cannot tell a
    # 3x2 window from a 2x3 one (both are 7 boxes), so state it at the source.
    _g = window_grid(False)
    _bars = len(_g.split(only_watertight=False))
    print(f"  window grid: 2 vertical + 1 horizontal gridline -> 3 columns x 2 rows "
          f"({_bars} bars incl. 4 border)")
    for name, mesh in (("tardis_body", body), ("tardis_windows", windows)):
        baked = mesh.copy()
        baked.apply_transform(transform)
        path = os.path.join(out_dir, f"{name}.stl")
        baked.export(path, file_type="stl")
        print(f"  {name}.stl  {os.path.getsize(path) / 1024:6.0f} KB  "
              f"{len(baked.faces):>6} tris  extents {baked.extents.round(2)}")


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/modular-tardis-model_files")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
    main(src, os.path.normpath(out))
