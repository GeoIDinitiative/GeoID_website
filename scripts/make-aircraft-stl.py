#!/usr/bin/env python3
"""Build Earth Flight's light aircraft as binary STLs.

    python3 scripts/make-aircraft-stl.py        # writes assets/aircraft/cessna_*.stl

WHY GENERATED. The flight sim's ships are STLs (assets/ships/), and the
aircraft was asked for the same way. No aircraft model with a licence that is
clean for commercial use and a clear author could be confirmed from this
machine, so the model is built here instead, from published Cessna 172-class
proportions: 8.3 m long, 11.0 m span, 2.7 m tall, a high constant-chord wing
on struts, fixed tricycle gear. It is original geometry -- an approximation of
the type, not a copy of any model -- and is released with the rest of this
repository under its licence (see assets/aircraft/README.md).

Frame: metres; nose toward -Z, up +Y, right +X -- the frame scripts/flightsim.js
flies every ship in. One STL per material (hull, trim, glass, prop), which is
how the sim's attachBaked() colours a model.
"""
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "aircraft"


class Mesh:
    def __init__(self):
        self.tris = []

    def tri(self, a, b, c):
        self.tris.append((a, b, c))

    def quad(self, a, b, c, d):
        self.tri(a, b, c)
        self.tri(a, c, d)

    def write(self, path):
        with open(path, "wb") as f:
            f.write(b"GeoID Earth Flight aircraft".ljust(80, b" "))
            f.write(struct.pack("<I", len(self.tris)))
            for a, b, c in self.tris:
                ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
                vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
                nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
                f.write(struct.pack("<12fH", nx / ln, ny / ln, nz / ln, *a, *b, *c, 0))


def loft(mesh, sections, seg=20, cap_front=True, cap_back=True):
    """Sections: [(z, cx, cy, half_w, half_h, power)] -> a closed superellipse tube."""
    rings = []
    for z, cx, cy, hw, hh, pw in sections:
        ring = []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            c, s = math.cos(t), math.sin(t)
            x = cx + hw * math.copysign(abs(c) ** (2 / pw), c)
            y = cy + hh * math.copysign(abs(s) ** (2 / pw), s)
            ring.append((x, y, z))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            # Outward winding for a tube running toward +Z.
            mesh.quad(r0[i], r0[j], r1[j], r1[i])
    for ring, front in ((rings[0], True), (rings[-1], False)):
        if (front and not cap_front) or (not front and not cap_back):
            continue
        cxm = sum(p[0] for p in ring) / seg
        cym = sum(p[1] for p in ring) / seg
        ctr = (cxm, cym, ring[0][2])
        for i in range(seg):
            j = (i + 1) % seg
            if front:
                mesh.tri(ctr, ring[j], ring[i])
            else:
                mesh.tri(ctr, ring[i], ring[j])


AIRFOIL = [(1.0, 0.0), (0.75, 0.035), (0.45, 0.06), (0.2, 0.065), (0.06, 0.045), (0.0, 0.0),
           (0.06, -0.02), (0.2, -0.025), (0.45, -0.02), (0.75, -0.01)]


def surface(mesh, x0, x1, z_le, chord, y, thick=1.0, vertical=False, taper=1.0, sweep=0.0):
    """A wing-like surface from x0 to x1 (span axis X, or Y if vertical)."""
    def section(s, along):
        c = chord * (1 - (1 - taper) * along)
        zl = z_le + sweep * along
        pts = []
        for u, v in AIRFOIL:
            zz = zl + u * c
            off = v * c * thick
            pts.append((s, y + off, zz) if not vertical else (off, s, zz))
        return pts
    a, b = section(x0, 0.0), section(x1, 1.0)
    n = len(AIRFOIL)
    for i in range(n):
        j = (i + 1) % n
        if (x1 > x0) ^ vertical:
            mesh.quad(a[i], a[j], b[j], b[i])
        else:
            mesh.quad(a[i], b[i], b[j], a[j])
    for ring, first in ((a, True), (b, False)):
        c = tuple(sum(p[k] for p in ring) / n for k in range(3))
        for i in range(n):
            j = (i + 1) % n
            if first ^ ((x1 > x0) ^ vertical):
                mesh.tri(c, ring[i], ring[j])
            else:
                mesh.tri(c, ring[j], ring[i])


def beam(mesh, p0, p1, r, sides=6):
    """A strut: a closed prism from p0 to p1."""
    d = [p1[k] - p0[k] for k in range(3)]
    ln = math.sqrt(sum(x * x for x in d)) or 1
    d = [x / ln for x in d]
    up = (0, 1, 0) if abs(d[1]) < 0.9 else (1, 0, 0)
    u = (d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0])
    lu = math.sqrt(sum(x * x for x in u)); u = [x / lu for x in u]
    v = (d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0])
    ring = lambda p: [tuple(p[k] + r * (math.cos(2 * math.pi * i / sides) * u[k] + math.sin(2 * math.pi * i / sides) * v[k]) for k in range(3)) for i in range(sides)]
    a, b = ring(p0), ring(p1)
    for i in range(sides):
        j = (i + 1) % sides
        mesh.quad(a[i], a[j], b[j], b[i])
    for i in range(1, sides - 1):
        mesh.tri(a[0], a[i + 1], a[i])
        mesh.tri(b[0], b[i], b[i + 1])


def wheel(mesh, cx, cy, cz, r, w, sides=12):
    rings = []
    for x in (cx - w / 2, cx + w / 2):
        rings.append([(x, cy + r * math.cos(2 * math.pi * i / sides), cz + r * math.sin(2 * math.pi * i / sides)) for i in range(sides)])
    a, b = rings
    for i in range(sides):
        j = (i + 1) % sides
        mesh.quad(a[i], b[i], b[j], a[j])
    for i in range(1, sides - 1):
        mesh.tri(a[0], a[i], a[i + 1])
        mesh.tri(b[0], b[i + 1], b[i])


def build():
    hull, trim, glass, prop = Mesh(), Mesh(), Mesh(), Mesh()
    # Fuselage: nose at z=-4.0 (cowling), cabin over z -2.6..0.4, tail cone to +4.3.
    loft(hull, [
        (-4.00, 0, 0.05, 0.30, 0.30, 2.2),
        (-3.70, 0, 0.08, 0.50, 0.45, 2.4),
        (-3.00, 0, 0.12, 0.56, 0.55, 2.8),
        (-2.40, 0, 0.30, 0.58, 0.80, 3.2),
        (-1.20, 0, 0.32, 0.60, 0.86, 3.4),
        (0.20, 0, 0.28, 0.56, 0.80, 3.2),
        (1.20, 0, 0.30, 0.42, 0.55, 2.8),
        (2.60, 0, 0.40, 0.25, 0.34, 2.4),
        (3.90, 0, 0.50, 0.12, 0.20, 2.2),
        (4.30, 0, 0.52, 0.06, 0.10, 2.0),
    ], seg=20)
    # High wing, 11.0 m span, 1.6 m chord, on top of the cabin; slight dihedral.
    wing_y = 1.18
    for side in (-1, 1):
        surface(hull, 0.0, side * 5.5, -1.95, 1.62, wing_y, thick=1.0)
    # Tailplane and fin.
    for side in (-1, 1):
        surface(hull, 0.0, side * 1.7, 3.35, 0.95, 0.52, thick=0.8, taper=0.75, sweep=0.15)
    surface(hull, 0.55, 1.85, 3.0, 1.25, 0.0, thick=0.7, vertical=True, taper=0.55, sweep=0.55)
    # Struts, gear legs, wheels.
    for side in (-1, 1):
        beam(trim, (side * 0.55, -0.35, -1.25), (side * 2.6, wing_y - 0.02, -1.35), 0.045)
        beam(trim, (side * 0.5, -0.4, -0.7), (side * 1.15, -1.05, -0.65), 0.05)
        wheel(trim, side * 1.15, -1.12, -0.65, 0.28, 0.16)
    beam(trim, (0, -0.25, -3.25), (0, -1.05, -3.3), 0.05)
    wheel(trim, 0, -1.12, -3.3, 0.24, 0.13)
    # Glass: windscreen and side windows as a slightly proud shell over the cabin top.
    loft(glass, [
        (-2.35, 0, 0.62, 0.585, 0.62, 3.2),
        (-1.20, 0, 0.62, 0.605, 0.62, 3.4),
        (0.10, 0, 0.58, 0.565, 0.58, 3.2),
    ], seg=20)
    # Propeller: spinner and two blades, in the disc at z = -4.15.
    loft(prop, [(-4.45, 0, 0.05, 0.02, 0.02, 2), (-4.25, 0, 0.05, 0.14, 0.14, 2), (-4.02, 0, 0.05, 0.22, 0.22, 2)], seg=12)
    for side in (-1, 1):
        surface(prop, 0.0, side * 0.95, -4.22, 0.14, 0.05, thick=1.2, taper=0.6)
    return {"hull": hull, "trim": trim, "glass": glass, "prop": prop}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, mesh in build().items():
        path = OUT / f"cessna_{name}.stl"
        mesh.write(path)
        total += len(mesh.tris)
        print(f"{path.relative_to(OUT.parent.parent)}  {len(mesh.tris)} triangles  {path.stat().st_size} bytes")
    print(f"{total} triangles in all")


if __name__ == "__main__":
    main()
