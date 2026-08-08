#!/usr/bin/env python3
"""Parse a Wavefront OBJ keeping UVs and per-face material, and sample textures.

trimesh drops UVs when materials are skipped and normalises them when they are
not, so the OBJ is parsed directly here — the whole point of this module is to
keep the face -> UV -> texture link intact.

Written for the UFO bake, which is the first source in this project to arrive
with both UVs and its textures, including an emissive (map_Ke) map. That lets a
glow group be READ OFF THE ART instead of guessed from geometry.
"""

import os

import numpy as np


def parse_obj(path):
    """-> (vertices, uvs, normals, tris, tri_uvs, tri_norms, tri_material, tri_object).

    Faces are fan-triangulated. Indices are 1-based in OBJ and may be negative
    (relative); both are handled. Missing vt/vn slots come back as -1.

    Normals are kept because the source author's vn data already encodes the
    intended smoothing groups — recomputing them would either flatten the dome
    or round off the hull's hard edges.
    """
    verts, uvs, norms = [], [], []
    tris, tri_uvs, tri_norms, tri_mat, tri_obj = [], [], [], [], []
    cur_mat, cur_obj = "", ""
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                p = line.split()
                uvs.append([float(p[1]), float(p[2])])
            elif line.startswith("vn "):
                norms.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("usemtl"):
                cur_mat = line.split(maxsplit=1)[1].strip() if len(line.split()) > 1 else ""
            elif line.startswith("o "):
                cur_obj = line[2:].strip()
            elif line.startswith("f "):
                vi, ti, ni = [], [], []
                for c in line.split()[1:]:
                    bits = c.split("/")
                    v = int(bits[0])
                    vi.append(v - 1 if v > 0 else len(verts) + v)
                    if len(bits) > 1 and bits[1]:
                        t = int(bits[1])
                        ti.append(t - 1 if t > 0 else len(uvs) + t)
                    else:
                        ti.append(-1)
                    if len(bits) > 2 and bits[2]:
                        nn = int(bits[2])
                        ni.append(nn - 1 if nn > 0 else len(norms) + nn)
                    else:
                        ni.append(-1)
                for k in range(1, len(vi) - 1):        # fan triangulation
                    tris.append([vi[0], vi[k], vi[k + 1]])
                    tri_uvs.append([ti[0], ti[k], ti[k + 1]])
                    tri_norms.append([ni[0], ni[k], ni[k + 1]])
                    tri_mat.append(cur_mat)
                    tri_obj.append(cur_obj)
    return (np.array(verts, float), np.array(uvs, float), np.array(norms, float),
            np.array(tris, np.int64), np.array(tri_uvs, np.int64),
            np.array(tri_norms, np.int64), np.array(tri_mat), np.array(tri_obj))


def load_image(path, max_side=1024):
    """Load a texture as float RGB in 0..1, downsampled — we only need averages."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    if max(im.size) > max_side:
        im = im.resize((max_side, max_side), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32) / 255.0


def sample(img, uv):
    """Nearest-texel sample at UV. OBJ v is bottom-up; image row 0 is the top."""
    h, w = img.shape[:2]
    u = np.mod(uv[:, 0], 1.0)
    v = np.mod(uv[:, 1], 1.0)
    x = np.clip((u * (w - 1)).astype(int), 0, w - 1)
    y = np.clip(((1.0 - v) * (h - 1)).astype(int), 0, h - 1)
    return img[y, x]


def face_uv_centroids(uvs, tri_uvs):
    """Mean UV per triangle; triangles without UVs come back as NaN."""
    out = np.full((len(tri_uvs), 2), np.nan)
    ok = (tri_uvs >= 0).all(axis=1)
    out[ok] = uvs[tri_uvs[ok]].mean(axis=1)
    return out


def sample_faces(img, uvs, tri_uvs, shrink=0.65):
    """Per-triangle texture colour, averaged over 4 taps.

    A single centroid tap is fragile: on a packed atlas a triangle whose centroid
    lands on a seam or an unused black gutter reports black, which then gets read
    as "this panel is painted black". Averaging the centroid with the three
    corners pulled `shrink` of the way in toward it stays inside the island and
    smooths that out.
    """
    res = np.zeros((len(tri_uvs), 3), np.float32)
    ok = (tri_uvs >= 0).all(axis=1)
    if not ok.any():
        return res, ok
    corner = uvs[tri_uvs[ok]]                 # (n, 3, 2)
    cen = corner.mean(axis=1)                 # (n, 2)
    acc = sample(img, cen).astype(np.float32)
    for k in range(3):
        pulled = cen + (corner[:, k, :] - cen) * shrink
        acc = acc + sample(img, pulled).astype(np.float32)
    res[ok] = acc / 4.0
    return res, ok
