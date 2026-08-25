#!/usr/bin/env python3
"""Bake the flying saucer from Low_poly_UFO_OBJ.

This is the first source in the project that arrives COMPLETE: geometry, UVs,
and its textures — including the emissive maps the .mtl names via map_Ke. Every
earlier ship had to have its lit parts guessed from geometry (X-wing, Falcon) or
from shell positions (Enterprise), because their textures were either missing,
unpacked or in a RAR nothing here can open. Here the glow group is READ OFF THE
ARTIST'S GLOW MAP, so it is correct by construction rather than by inference.

The runtime loads STL, which carries neither UVs nor materials, so the textures
cannot be shipped as textures. Instead each triangle is sampled against the
diffuse and glow maps and sorted into one of three material groups. That keeps
the artist's intent (which panels are dark, which surfaces light up) without
needing a textured loader.

At 1,706 triangles the model needs no decimation.

Axes: already Y-up, and a saucer has no forward, so the only transform is
centring. Nothing is rotated or mirrored.

    python3 tools/build_ufo_from_obj.py [dir]
"""

import argparse
import os
import sys

import numpy as np
import trimesh

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obj_uv_sampler import load_image, parse_obj, sample_faces   # noqa: E402

SRC_DIR = os.path.expanduser("~/Downloads/Low_poly_UFO_OBJ")
TARGET_DIAMETER = 15.0      # viewer units — the nominalLength buildSaucer used

# material name -> (diffuse map, emissive map), straight from the .mtl
TEXTURES = {
    "UFO_texture":  ("ufo_diffuse.png",  "ufo_diffuse_glow.png"),
    "UFO_texture2": ("ufo_diffuse2.png", "ufo_diffuse2_glow.png"),
}

# The cockpit dome is emissive over its whole area, so it is taken wholesale.
# On the body the glow map marks discrete underside lights, and those need a
# threshold: too high and the rim lights vanish, too low and atlas bleed on the
# hull starts lighting up. 0.2 keeps the ~90 lit faces spanning the underside.
BODY_GLOW_CUTOFF = 0.2
# Splits the unlit faces into painted hull vs the near-black panel work.
DARK_LUMA_CUTOFF = 0.18
LUMA = np.array([0.2126, 0.7152, 0.0722])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", nargs="?", default=SRC_DIR)
    args = ap.parse_args()
    d = args.src_dir.rstrip("/") + "/"

    verts, uvs, tris, tri_uvs, tri_mat, tri_obj = parse_obj(d + "Low_poly_UFO.obj")
    print(f"source: {len(tris)} tris, {len(verts)} verts, {len(uvs)} uvs")

    glow = np.zeros((len(tris), 3), np.float32)
    diffuse = np.zeros((len(tris), 3), np.float32)
    for mat, (dif_name, glow_name) in TEXTURES.items():
        sel = tri_mat == mat
        if not sel.any():
            continue
        gs, _ = sample_faces(load_image(d + glow_name), uvs, tri_uvs[sel])
        ds, _ = sample_faces(load_image(d + dif_name), uvs, tri_uvs[sel])
        glow[sel], diffuse[sel] = gs, ds
        print(f"  {mat:<14} {sel.sum():>5} tris  <- {dif_name}, {glow_name}")

    glow_max = glow.max(axis=1)
    luma = diffuse @ LUMA
    is_cockpit = tri_obj == "UFO_cockpit"

    lit = is_cockpit | (glow_max > BODY_GLOW_CUTOFF)
    dark = ~lit & (luma <= DARK_LUMA_CUTOFF)
    hull = ~lit & ~dark

    centre = (verts.min(0) + verts.max(0)) / 2
    v = verts - centre                      # Y is already up; no rotation wanted

    groups = {"glow": lit, "dark": dark, "hull": hull}
    out_dir = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "assets"))

    print()
    written = 0
    for name, mask in groups.items():
        if not mask.any():
            continue
        m = trimesh.Trimesh(vertices=v, faces=tris[mask], process=False)
        m.remove_unreferenced_vertices()
        path = os.path.join(out_dir, f"ufo_{name}.stl")
        m.export(path, file_type="stl")
        written += len(m.faces)
        # Report the average sampled colour so the material can match the art.
        src = glow[mask] if name == "glow" else diffuse[mask]
        avg = src[src.max(axis=1) > 0].mean(0) if (src.max(axis=1) > 0).any() else src.mean(0)
        rgb = "#%02x%02x%02x" % tuple(int(round(c * 255)) for c in np.clip(avg, 0, 1))
        print(f"  ufo_{name}.stl  {os.path.getsize(path)/1024:6.0f} KB  "
              f"{len(m.faces):>5} tris   sampled colour {rgb}")

    whole = trimesh.Trimesh(vertices=v, faces=tris, process=False)
    diameter = max(whole.extents[0], whole.extents[2])
    print(f"\nassembled extents {whole.extents.round(2)} (diameter {diameter:.2f})")
    print(f"  -> flightsim.js scale factor {TARGET_DIAMETER}/{diameter:.4f} = "
          f"{TARGET_DIAMETER / diameter:.5f}")
    print(f"  total {written} triangles in 3 groups (no decimation)")


if __name__ == "__main__":
    main()
