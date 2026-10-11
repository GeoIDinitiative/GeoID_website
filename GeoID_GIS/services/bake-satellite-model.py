#!/usr/bin/env python3
"""
Bake the satellite model the live tracker draws close in.

Writes four small binary STLs to GeoID_GIS/viewer/assets/models/, one per
material, because STL carries no colour and the tracker paints each part
differently (an InstancedMesh per part, all sharing one instance matrix per
satellite):

    satellite_bus.stl     the body, in gold foil
    satellite_wings.stl   two solar-array wings on their yokes
    satellite_dish.stl    the nadir dish, its feed and a zenith whip antenna
    satellite_accent.stl  a band round the body, tinted by the category colour

Frame, in metres, centred on the body:
    +X  along-track (the velocity)
    +Y  orbit normal (the wings' axis, as on most three-axis-stabilised craft)
    +Z  zenith (away from the Earth); the dish faces -Z, the nadir

Stdlib only. Deterministic, so re-running it rewrites identical bytes.
"""

import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "viewer" / "assets" / "models"


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    length = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) or 1.0
    return (a[0] / length, a[1] / length, a[2] / length)


class Mesh:
    def __init__(self):
        self.tris = []

    def tri(self, a, b, c):
        self.tris.append((a, b, c))

    def quad(self, a, b, c, d):
        self.tri(a, b, c)
        self.tri(a, c, d)

    def box(self, cx, cy, cz, hx, hy, hz):
        """An axis-aligned box, every face wound outward."""
        x0, x1 = cx - hx, cx + hx
        y0, y1 = cy - hy, cy + hy
        z0, z1 = cz - hz, cz + hz
        self.quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))  # +z
        self.quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0))  # -z
        self.quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1))  # +x
        self.quad((x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0))  # -x
        self.quad((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0))  # +y
        self.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1))  # -y

    def cylinder_z(self, cx, cy, z0, z1, r, segments=16, caps=True):
        """A cylinder along Z from z0 to z1."""
        ring = [(cx + r * math.cos(2 * math.pi * i / segments),
                 cy + r * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
        for i in range(segments):
            (ax, ay), (bx, by) = ring[i], ring[(i + 1) % segments]
            self.quad((ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1))
            if caps:
                self.tri((cx, cy, z1), (ax, ay, z1), (bx, by, z1))
                self.tri((cx, cy, z0), (bx, by, z0), (ax, ay, z0))

    def cylinder_y(self, cx, cz, y0, y1, r, segments=10):
        """A cylinder along Y (the wing yokes)."""
        ring = [(cx + r * math.cos(2 * math.pi * i / segments),
                 cz + r * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
        for i in range(segments):
            (ax, az), (bx, bz) = ring[i], ring[(i + 1) % segments]
            self.quad((ax, y0, az), (ax, y1, az), (bx, y1, bz), (bx, y0, bz))

    def sphere(self, cx, cy, cz, r, rings=6, segments=10):
        def p(i, j):
            theta = math.pi * i / rings
            phi = 2 * math.pi * j / segments
            return (cx + r * math.sin(theta) * math.cos(phi),
                    cy + r * math.sin(theta) * math.sin(phi),
                    cz + r * math.cos(theta))
        for i in range(rings):
            for j in range(segments):
                a, b = p(i, j), p(i + 1, j)
                c, d = p(i + 1, j + 1), p(i, j + 1)
                if i == 0:
                    self.tri(a, b, c)
                elif i == rings - 1:
                    self.tri(a, b, d)
                else:
                    self.quad(a, b, c, d)

    def dish(self, cz, radius, depth, segments=24, rings=5):
        """A paraboloid dish whose open side faces -Z, vertex at cz."""
        def p(i, j):
            r = radius * i / rings
            phi = 2 * math.pi * j / segments
            # The bowl opens downward (toward the nadir): the rim is lower
            # than the vertex by `depth`.
            z = cz - depth * (r / radius) ** 2
            return (r * math.cos(phi), r * math.sin(phi), z)
        for i in range(rings):
            for j in range(segments):
                a, b = p(i, j), p(i + 1, j)
                c, d = p(i + 1, j + 1), p(i, j + 1)
                if i == 0:
                    self.tri(a, c, b)
                else:
                    self.quad(a, d, c, b)

    def binary(self, header):
        data = bytearray(header.encode("ascii")[:80].ljust(80, b" "))
        data += struct.pack("<I", len(self.tris))
        for a, b, c in self.tris:
            n = norm(cross(sub(b, a), sub(c, a)))
            data += struct.pack("<12fH", *n, *a, *b, *c, 0)
        return bytes(data)


def build():
    bus = Mesh()
    # The body, 1.4 x 1.2 x 1.6 m, with a thruster skirt under the dish deck.
    bus.box(0, 0, 0, 0.7, 0.6, 0.8)
    bus.box(0.74, 0, 0.1, 0.04, 0.35, 0.45)   # a star tracker housing, along-track
    bus.cylinder_z(0, 0, 0.8, 0.95, 0.28, 12)  # a zenith radiator collar

    wings = Mesh()
    for side in (-1, 1):
        # Yoke: a boom from the body to the first panel.
        wings.cylinder_y(0, 0, side * 0.6, side * 1.15, 0.045)
        # Four panels per wing, with gaps, so the wing reads as an array.
        y = 1.15
        for _ in range(4):
            wings.box(0, side * (y + 0.42), 0, 0.82, 0.4, 0.025)
            y += 0.86
        # Edge rails tying the panels together.
        wings.box(0.84, side * (1.15 + 1.72), 0, 0.02, 1.72, 0.03)
        wings.box(-0.84, side * (1.15 + 1.72), 0, 0.02, 1.72, 0.03)

    dish = Mesh()
    dish.cylinder_z(0, 0, -1.05, -0.8, 0.06, 10)   # mast from the nadir deck
    dish.dish(-1.05, 0.75, 0.22)                    # the reflector, facing nadir
    dish.cylinder_z(0, 0, -1.55, -1.05, 0.025, 8)   # the feed boom
    dish.sphere(0, 0, -1.58, 0.07)                  # the feed horn
    dish.cylinder_z(-0.45, 0.35, 0.95, 1.9, 0.018, 6)  # a zenith whip antenna

    accent = Mesh()
    # A band round the body's waist, proud of the foil by 2 cm.
    accent.box(0, 0, 0.45, 0.72, 0.62, 0.08)

    return {
        "satellite_bus.stl": bus,
        "satellite_wings.stl": wings,
        "satellite_dish.stl": dish,
        "satellite_accent.stl": accent,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, mesh in build().items():
        data = mesh.binary(f"GeoID live satellite model - {name} - metres, +Z zenith, +X along-track")
        (OUT / name).write_bytes(data)
        total += len(data)
        print(f"{name}: {len(mesh.tris)} triangles, {len(data):,} bytes")
    print(f"total {total:,} bytes in {OUT}")


if __name__ == "__main__":
    main()
