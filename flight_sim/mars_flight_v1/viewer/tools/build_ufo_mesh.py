#!/usr/bin/env python3
"""Bake the flying saucer as a TEXTURED mesh, not as flat colour groups.

Every other ship in this project ships as per-material STLs, because their
sources arrived without usable textures. This one came complete — diffuse,
emissive (map_Ke), normal and spec maps, plus UVs and the author's own vertex
normals — and forcing it through STL threw all of that away: STL carries neither
UVs nor normals-per-vertex, so the saucer rendered as three flat colours and
looked exactly as cheap as that sounds.

So this writes a small interleaved vertex buffer instead, and the runtime binds
the real textures. Format ("GMSH", little-endian):

    magic "GMSH" | u32 version | u32 vertexCount | u32 indexCount
    vertexCount x 8 float32:  px py pz  nx ny nz  u v
    indexCount  x u32
    u32 groupCount, then per group: u32 start, u32 count, u32 materialIndex

Vertex normals come from the OBJ's vn data rather than being recomputed —
the author's smoothing groups already distinguish the smooth dome from the
hull's hard panel edges, and recomputing would lose one or the other.

    python3 tools/build_ufo_mesh.py [dir]
"""

import argparse
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from obj_uv_sampler import parse_obj   # noqa: E402

SRC_DIR = os.path.expanduser("~/Downloads/Low_poly_UFO_OBJ")
TARGET_DIAMETER = 15.0      # viewer units — the nominalLength buildSaucer used

# Material order defines the materialIndex written into the groups.
MATERIALS = ["UFO_texture", "UFO_texture2"]
# Lit-surface hues, as fractions of the colour wheel. The source art is green
# throughout; these recolour it at bake time.
#
# It is not enough to tint the EMISSIVE map: the dome and ring are green in the
# DIFFUSE map too, so lighting them cyan over a green base still reads green.
# Both maps get the shift, and only where the pixel is actually green — the grey
# hull plating has near-zero saturation and is left alone.
HUE_DOME = 0.50     # cyan
HUE_RING = 0.78     # purple

# (source file, output name, max side, encoder, hue) per map we bind. hue=None
# leaves the image untouched — the normal map must never be recoloured, its RGB
# encodes a vector, not a colour.
TEXTURES = [
    ("ufo_diffuse.png",       "ufo_diffuse.jpg",   1024, "jpg", HUE_DOME),
    ("ufo_diffuse_glow.png",  "ufo_glow.png",       512, "png", HUE_DOME),
    ("ufo_normal.png",        "ufo_normal.jpg",    1024, "jpg", None),
    ("ufo_diffuse2.png",      "ufo_diffuse2.jpg",   512, "jpg", HUE_RING),
    ("ufo_diffuse2_glow.png", "ufo_glow2.png",      256, "png", HUE_RING),
]

# Which hues count as "the green to replace". The art sits around 0.33; this band
# is wide enough to catch the dome's shading but excludes the hull's cool grey.
GREEN_LO, GREEN_HI = 0.20, 0.47
MIN_SAT = 0.18


def shift_green_hue(im, hue):
    """Rotate the green pixels of an image to `hue`, keeping value and saturation.

    Only hue moves, so the dome keeps its shading and hex pattern and the ring
    keeps its falloff — a flat colour fill would destroy both. Grey plating is
    below MIN_SAT and is left exactly as it was.
    """
    import numpy as np
    from matplotlib.colors import hsv_to_rgb, rgb_to_hsv
    from PIL import Image

    arr = np.asarray(im).astype(np.float32) / 255.0
    rgb, alpha = arr[..., :3], (arr[..., 3:] if arr.shape[-1] == 4 else None)
    hsv = rgb_to_hsv(rgb)
    mask = ((hsv[..., 0] >= GREEN_LO) & (hsv[..., 0] <= GREEN_HI)
            & (hsv[..., 1] >= MIN_SAT))
    hsv[..., 0] = np.where(mask, hue, hsv[..., 0])
    out = np.clip(hsv_to_rgb(hsv), 0, 1)
    if alpha is not None:
        out = np.concatenate([out, alpha], axis=-1)
    return Image.fromarray((out * 255).round().astype(np.uint8)), float(mask.mean())


def write_textures(src_dir, out_dir):
    from PIL import Image
    for src, dst, side, kind, hue in TEXTURES:
        path = os.path.join(src_dir, src)
        if not os.path.exists(path):
            print(f"  ! missing {src}")
            continue
        im = Image.open(path)
        im = im.convert("RGB") if kind == "jpg" else im.convert("RGBA")
        if max(im.size) > side:
            im = im.resize((side, side), Image.LANCZOS)
        note = ""
        if hue is not None:
            im, frac = shift_green_hue(im, hue)
            note = f"  hue->{hue:.2f} on {frac * 100:.1f}% of pixels"
        out = os.path.join(out_dir, dst)
        if kind == "jpg":
            im.save(out, "JPEG", quality=88, optimize=True)
        else:
            im.save(out, "PNG", optimize=True)
        print(f"  {dst:<20} {os.path.getsize(out)/1024:6.0f} KB  ({side}px){note}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", nargs="?", default=SRC_DIR)
    args = ap.parse_args()
    d = args.src_dir.rstrip("/")

    verts, uvs, norms, tris, tri_uvs, tri_norms, tri_mat, _ = parse_obj(
        os.path.join(d, "Low_poly_UFO.obj"))
    print(f"source: {len(tris)} tris, {len(verts)} v, {len(uvs)} vt, {len(norms)} vn")

    centre = (verts.min(0) + verts.max(0)) / 2
    scale = TARGET_DIAMETER / max(verts.max(0) - verts.min(0))
    pos = (verts - centre) * scale       # Y is already up; a saucer has no forward

    # Sort faces by material so each material becomes one contiguous draw group.
    order = np.argsort([MATERIALS.index(m) if m in MATERIALS else 99 for m in tri_mat],
                       kind="stable")
    tris, tri_uvs, tri_norms, tri_mat = (tris[order], tri_uvs[order],
                                         tri_norms[order], tri_mat[order])

    # OBJ indexes position/uv/normal independently; a GPU needs one index, so a
    # vertex is emitted per distinct (v, vt, vn) triple.
    lookup, out_v, indices = {}, [], []
    for tri, tuv, tn in zip(tris, tri_uvs, tri_norms):
        for k in range(3):
            key = (int(tri[k]), int(tuv[k]), int(tn[k]))
            idx = lookup.get(key)
            if idx is None:
                idx = len(out_v)
                lookup[key] = idx
                p = pos[key[0]]
                n = norms[key[2]] if key[2] >= 0 else (0.0, 1.0, 0.0)
                t = uvs[key[1]] if key[1] >= 0 else (0.0, 0.0)
                out_v.append((p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1]))
            indices.append(idx)

    groups = []
    start = 0
    for mi, mat in enumerate(MATERIALS):
        count = int((tri_mat == mat).sum()) * 3
        if count:
            groups.append((start, count, mi))
            start += count

    out_dir = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "assets"))
    blob = bytearray()
    blob += b"GMSH" + struct.pack("<III", 1, len(out_v), len(indices))
    blob += np.asarray(out_v, dtype="<f4").tobytes()
    blob += np.asarray(indices, dtype="<u4").tobytes()
    blob += struct.pack("<I", len(groups))
    for s, c, mi in groups:
        blob += struct.pack("<III", s, c, mi)
    path = os.path.join(out_dir, "ufo.gmsh")
    with open(path, "wb") as fh:
        fh.write(blob)

    print(f"\n  ufo.gmsh  {len(blob)/1024:6.0f} KB   "
          f"{len(out_v)} verts, {len(indices)//3} tris, {len(groups)} groups")
    for s, c, mi in groups:
        print(f"     group start={s:<6} count={c:<6} material={MATERIALS[mi]}")
    print()
    write_textures(d, out_dir)
    print(f"\n  diameter {TARGET_DIAMETER} in viewer units "
          f"(source {max(verts.max(0) - verts.min(0)):.3f}, scale {scale:.5f})")
    print("  -> flightsim.js needs NO extra scale factor; the bake is pre-scaled.")


if __name__ == "__main__":
    main()
