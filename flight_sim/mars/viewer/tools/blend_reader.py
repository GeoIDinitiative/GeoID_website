#!/usr/bin/env python3
"""Minimal reader for uncompressed .blend files (Blender 2.8-4.x meshes).

Blender is not installed here, `bpy` has no wheel for this Python, and no
pure-Python .blend reader is pip-installable — but a .blend is SELF-DESCRIBING:
a DNA1 block near the end carries the C struct layout of every struct in the
file it was written by. So the layout does not have to be hardcoded per version;
it is read out of the file and used to walk the blocks.

Only what the bake needs is extracted: vertex positions, faces, and the material
index per face. Blender 4.x keeps these in generic CustomData attribute layers
("position", ".corner_vert", "material_index") rather than in dedicated arrays,
which is why the layer lookup below is by NAME rather than by field.

    python3 tools/blend_reader.py ~/Downloads/X-wing.blend --list
"""

import argparse
import struct


class Blend:
    def __init__(self, path):
        data = open(path, "rb").read()
        if data[:7] != b"BLENDER":
            raise ValueError("not an uncompressed .blend (gzip/zstd is unsupported)")
        self.d = data
        self.ptr = 8 if data[7:8] == b"-" else 4
        self.en = "<" if data[8:9] == b"v" else ">"
        self.blocks = []
        self.by_addr = {}
        off = 12
        while off < len(data):
            code = data[off:off + 4]
            size, = struct.unpack(self.en + "I", data[off + 4:off + 8])
            old, = struct.unpack(self.en + ("Q" if self.ptr == 8 else "I"),
                                 data[off + 8:off + 8 + self.ptr])
            sdna, cnt = struct.unpack(self.en + "II", data[off + 8 + self.ptr:off + 16 + self.ptr])
            body = off + 16 + self.ptr
            rec = {"code": code, "size": size, "addr": old, "sdna": sdna,
                   "count": cnt, "at": body}
            self.blocks.append(rec)
            self.by_addr[old] = rec
            if code == b"ENDB":
                break
            off = body + size
        self._read_dna()

    # ── DNA1: names, types, sizes, struct field lists ────────────────────────
    def _read_dna(self):
        blk = next(b for b in self.blocks if b["code"] == b"DNA1")
        d, o = self.d, blk["at"]
        start = blk["at"]

        # The 4-byte padding between DNA sections is measured from the START OF
        # THE DNA BLOCK, not from the absolute file offset — block bodies are
        # not themselves aligned, so aligning `o` directly lands one byte short.
        def align4():
            nonlocal o
            o = start + ((o - start + 3) & ~3)

        def seq(tag):
            nonlocal o
            assert d[o:o + 4] == tag, (tag, d[o:o + 4])
            o += 4
            n, = struct.unpack(self.en + "I", d[o:o + 4])
            o += 4
            return n

        assert d[o:o + 4] == b"SDNA"
        o += 4
        n = seq(b"NAME")
        names = []
        for _ in range(n):
            e = d.index(b"\0", o)
            names.append(d[o:e].decode())
            o = e + 1
        align4()
        n = seq(b"TYPE")
        types = []
        for _ in range(n):
            e = d.index(b"\0", o)
            types.append(d[o:e].decode())
            o = e + 1
        align4()
        assert d[o:o + 4] == b"TLEN"
        o += 4
        tlen = struct.unpack(self.en + "%dH" % len(types), d[o:o + 2 * len(types)])
        o += 2 * len(types)
        align4()
        n = seq(b"STRC")
        structs, by_name = [], {}
        for _ in range(n):
            t, nf = struct.unpack(self.en + "HH", d[o:o + 4])
            o += 4
            fields = struct.unpack(self.en + "%dH" % (nf * 2), d[o:o + 4 * nf])
            o += 4 * nf
            f = [(types[fields[i]], names[fields[i + 1]]) for i in range(0, len(fields), 2)]
            structs.append((types[t], f))
            by_name[types[t]] = len(structs) - 1
        self.types, self.tlen, self.structs, self.struct_id = types, tlen, structs, by_name
        self.tsize = {t: tlen[i] for i, t in enumerate(types)}

    def field_offsets(self, sdna):
        """Byte offset and (type, name) of every field of a struct."""
        _, fields = self.structs[sdna]
        out, off = {}, 0
        for ftype, fname in fields:
            if fname.startswith("*") or "(*" in fname:
                size = self.ptr
            else:
                size = self.tsize.get(ftype, 0)
            n = 1
            base = fname
            while base.endswith("]"):
                i = base.rindex("[")
                n *= int(base[i + 1:-1])
                base = base[:i]
            base = base.lstrip("*")
            if fname.startswith("*"):
                size = self.ptr
            out[base] = (off, ftype, fname, size * n)
            off += size * n
        return out

    def get(self, blk, path, index=0):
        """Read a scalar/pointer field, e.g. get(mesh_block, 'totvert')."""
        offs = self.field_offsets(blk["sdna"])
        if path not in offs:
            return None
        stride = self.tlen[self.struct_id[self.structs[blk["sdna"]][0]]] if False else None
        off, ftype, fname, _ = offs[path]
        base = blk["at"] + off + index * self._struct_size(blk["sdna"])
        if fname.startswith("*") or "(*" in fname:
            v, = struct.unpack(self.en + ("Q" if self.ptr == 8 else "I"),
                               self.d[base:base + self.ptr])
            return v
        fmt = {"char": "b", "uchar": "B", "short": "h", "ushort": "H",
               "int": "i", "uint": "I", "float": "f", "double": "d",
               "int64_t": "q", "uint64_t": "Q", "int8_t": "b"}.get(ftype)
        if fmt is None:
            return None
        if fname.endswith("]") and ftype == "char":
            n = int(fname[fname.rindex("[") + 1:-1])
            raw = self.d[base:base + n]
            return raw.split(b"\0")[0].decode("utf-8", "replace")
        v, = struct.unpack(self.en + fmt, self.d[base:base + struct.calcsize(fmt)])
        return v

    def _struct_size(self, sdna):
        return self.tsize[self.structs[sdna][0]]

    def deref(self, addr):
        return self.by_addr.get(addr)

    def name_of(self, blk):
        n = self.get(blk, "id")
        offs = self.field_offsets(blk["sdna"])
        if "id" in offs:                       # ID is the first member; its name is at +2 bytes
            off, _, _, _ = offs["id"]
            idoffs = self.field_offsets(self.struct_id["ID"])
            noff = idoffs["name"][0]
            raw = self.d[blk["at"] + off + noff: blk["at"] + off + noff + 66]
            return raw.split(b"\0")[0].decode("utf-8", "replace")[2:]
        return n


def customdata_layers(bf, blk, member):
    """Yield (type, name, data_addr) for each CustomData layer of a mesh member."""
    offs = bf.field_offsets(blk["sdna"])
    if member not in offs:
        return
    cd_off = offs[member][0]
    cd_sdna = bf.struct_id["CustomData"]
    coffs = bf.field_offsets(cd_sdna)
    base = blk["at"] + cd_off
    lay_ptr, = struct.unpack(bf.en + "Q", bf.d[base + coffs["layers"][0]:base + coffs["layers"][0] + 8])
    totlayer, = struct.unpack(bf.en + "i", bf.d[base + coffs["totlayer"][0]:base + coffs["totlayer"][0] + 4])
    lb = bf.deref(lay_ptr)
    if lb is None:
        return
    lsz = bf._struct_size(bf.struct_id["CustomDataLayer"])
    loffs = bf.field_offsets(bf.struct_id["CustomDataLayer"])
    for i in range(totlayer):
        at = lb["at"] + i * lsz
        typ, = struct.unpack(bf.en + "i", bf.d[at + loffs["type"][0]:at + loffs["type"][0] + 4])
        nm_off = at + loffs["name"][0]
        nm = bf.d[nm_off:nm_off + 68].split(b"\0")[0].decode("utf-8", "replace")
        dp, = struct.unpack(bf.en + "Q", bf.d[at + loffs["data"][0]:at + loffs["data"][0] + 8])
        yield typ, nm, dp


def layer_data(bf, blk, member, name):
    """Raw bytes of one named CustomData layer."""
    for _typ, nm, dp in customdata_layers(bf, blk, member):
        if nm == name:
            b = bf.deref(dp)
            return None if b is None else bf.d[b["at"]:b["at"] + b["size"]]
    return None


def read_mesh(bf, blk):
    """(vertices, triangles, material_index_per_triangle) for one ME block.

    Blender stores faces as a CORNER RUN per polygon — poly i owns corners
    offsets[i]..offsets[i+1] — and those are n-gons, not triangles, so they are
    fan-triangulated here. Material index lives per POLYGON, so it is repeated
    across the fan.
    """
    import numpy as np
    nv, npoly = bf.get(blk, "totvert"), bf.get(blk, "totpoly")
    if not nv or not npoly:
        return None
    pos = layer_data(bf, blk, "vdata", "position")
    cv = layer_data(bf, blk, "ldata", ".corner_vert")
    if pos is None or cv is None:
        return None
    verts = np.frombuffer(pos[:nv * 12], dtype="<f4").reshape(-1, 3).astype(np.float64)
    corners = np.frombuffer(cv, dtype="<i4")

    ob = bf.deref(bf.get(blk, "poly_offset_indices"))
    offsets = np.frombuffer(bf.d[ob["at"]:ob["at"] + (npoly + 1) * 4], dtype="<i4")

    mi_raw = layer_data(bf, blk, "pdata", "material_index")
    mats = (np.frombuffer(mi_raw[:npoly * 4], dtype="<i4") if mi_raw is not None
            else np.zeros(npoly, dtype=np.int32))

    tris, tmat = [], []
    for i in range(npoly):
        a, b = offsets[i], offsets[i + 1]
        run = corners[a:b]
        for k in range(1, len(run) - 1):        # fan from the first corner
            tris.append((run[0], run[k], run[k + 1]))
            tmat.append(mats[i])
    return verts, np.array(tris, dtype=np.int64), np.array(tmat, dtype=np.int32)


def mesh_materials(bf, blk):
    """Names of the material slots of a mesh, in slot order."""
    n = bf.get(blk, "totcol") or 0
    mb = bf.deref(bf.get(blk, "mat"))
    if mb is None or n == 0:
        return []
    out = []
    for i in range(n):
        addr, = struct.unpack(bf.en + "Q", bf.d[mb["at"] + i * 8:mb["at"] + i * 8 + 8])
        m = bf.deref(addr)
        out.append(bf.name_of(m) if m is not None else f"slot{i}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    bf = Blend(args.src)
    print(f"{len(bf.blocks)} blocks, {len(bf.structs)} DNA structs, ptr={bf.ptr}")
    for b in bf.blocks:
        if b["code"] == b"ME\0\0":
            nm = bf.name_of(b)
            tv = bf.get(b, "totvert")
            tp = bf.get(b, "faces_num") or bf.get(b, "totpoly")
            tl = bf.get(b, "totloop") or bf.get(b, "corners_num")
            print(f"  mesh {nm:<28} verts={tv:<8} faces={tp} loops={tl}")
            if args.list:
                for typ, nm2, dp in customdata_layers(bf, b, "vdata"):
                    print(f"      vdata  type={typ:<4} {nm2}")
                for typ, nm2, dp in customdata_layers(bf, b, "ldata"):
                    print(f"      ldata  type={typ:<4} {nm2}")


if __name__ == "__main__":
    main()
