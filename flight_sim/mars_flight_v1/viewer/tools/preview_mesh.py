#!/usr/bin/env python3
"""Render meshes to a PNG so a bake can be checked without a browser.

Written because the browser preview pane stopped compositing frames partway
through this work, and three police-box rebuilds shipped wrong precisely because
they were only ever verified numerically. A silhouette is the cheapest way to
catch "that is not the right shape".

No GPU and no pyglet — just a painter's algorithm: project the triangles,
sort back-to-front, fill them with flat shading from a fixed light. Good enough
to judge proportion, orientation and assembly, which is all it is for.

    python3 tools/preview_mesh.py a.stl b.stl --out check.png --views front,side,top
"""

import argparse
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt          # noqa: E402
import numpy as np                       # noqa: E402
import trimesh                           # noqa: E402
from matplotlib.collections import PolyCollection   # noqa: E402

# (eye direction, up) per named view. Eye looks from that direction toward origin.
VIEWS = {
    "front": ([0, 0, 1], [0, 1, 0]),
    "back": ([0, 0, -1], [0, 1, 0]),
    "side": ([1, 0, 0], [0, 1, 0]),
    "top": ([0, 1, 0], [0, 0, -1]),
    "iso": ([1, 0.8, 1], [0, 1, 0]),
}
PALETTE = ["#5b7fa6", "#d8a657", "#8fbf6f", "#c96f6f", "#9b8fc4"]


def render(ax, meshes, eye, up, colours):
    eye = np.array(eye, float)
    eye /= np.linalg.norm(eye)
    up = np.array(up, float)
    right = np.cross(up, eye)
    right /= np.linalg.norm(right)
    true_up = np.cross(eye, right)
    light = np.array([0.4, 0.8, 0.6])
    light /= np.linalg.norm(light)

    polys, facecolours, depths = [], [], []
    for mesh, base in zip(meshes, colours):
        v = mesh.vertices[mesh.faces]                      # (n, 3, 3)
        n = mesh.face_normals
        # backface cull, then flat-shade by angle to the light
        facing = n @ eye
        keep = facing > -0.05
        v, n = v[keep], n[keep]
        shade = np.clip(0.35 + 0.65 * np.abs(n @ light), 0, 1)
        rgb = np.array(matplotlib.colors.to_rgb(base))
        cols = shade[:, None] * rgb[None, :]
        polys.extend(np.stack([v @ right, v @ true_up], axis=-1))
        facecolours.extend(cols)
        depths.extend((v @ eye).mean(1))

    order = np.argsort(depths)                              # far to near
    pc = PolyCollection([polys[i] for i in order],
                        facecolors=[facecolours[i] for i in order],
                        edgecolors="none")
    ax.add_collection(pc)
    ax.set_aspect("equal")
    ax.autoscale_view()
    allpts = np.concatenate(polys).reshape(-1, 2)
    pad = 0.04 * float(np.ptp(allpts, axis=0).max())
    ax.set_xlim(allpts[:, 0].min() - pad, allpts[:, 0].max() + pad)
    ax.set_ylim(allpts[:, 1].min() - pad, allpts[:, 1].max() + pad)
    ax.axis("off")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("meshes", nargs="+")
    ap.add_argument("--out", default="preview.png")
    ap.add_argument("--views", default="front,side,top,iso")
    ap.add_argument("--size", type=float, default=3.2, help="inches per view")
    ap.add_argument("--colours", help="comma-separated hex per mesh, e.g. #dcdee3,#cbd0d7")
    ap.add_argument("--bg", default="#f4f4f2", help="background colour")
    args = ap.parse_args()

    meshes = [trimesh.load(m, force="mesh") for m in args.meshes]
    if args.colours:
        given = [c.strip() for c in args.colours.split(",")]
        colours = [given[i] if i < len(given) else PALETTE[i % len(PALETTE)]
                   for i in range(len(meshes))]
    else:
        colours = [PALETTE[i % len(PALETTE)] for i in range(len(meshes))]
    views = [v.strip() for v in args.views.split(",") if v.strip() in VIEWS]

    fig, axes = plt.subplots(1, len(views), figsize=(args.size * len(views), args.size))
    if len(views) == 1:
        axes = [axes]
    for ax, name in zip(axes, views):
        render(ax, meshes, *VIEWS[name], colours)
        ax.set_title(name, fontsize=9, color="#888")
    fig.patch.set_facecolor(args.bg)
    fig.tight_layout()
    fig.savefig(args.out, dpi=110, facecolor=fig.get_facecolor())
    tris = sum(len(m.faces) for m in meshes)
    print(f"wrote {args.out}  ({tris} triangles across {len(meshes)} mesh(es))")
    for m, f in zip(meshes, args.meshes):
        print(f"   {os.path.basename(f):<28} {len(m.faces):>6} tris  extents {m.extents.round(1)}")


if __name__ == "__main__":
    main()
