#!/usr/bin/env python3
"""
Bake the aircraft and ship models the live traffic trackers draw close in.

Six small binary STLs in GeoID_GIS/viewer/assets/models/, three per craft,
one per material, because STL carries no colour and the tracker paints each
part differently (an InstancedMesh per part, all sharing one instance matrix
per craft) -- the satellite tracker's arrangement exactly:

    aircraft_body.stl    fuselage and tailplane, in white
    aircraft_wings.stl   wings and engines, in grey
    aircraft_accent.stl  the fin, tinted by the altitude band
    ship_hull.stl        the hull, in dark grey
    ship_deck.stl        accommodation block, bridge wings and funnel
    ship_cargo.stl       the deck cargo, tinted by the ship's family

Frame, in metres, centred on the craft:
    +X  forward (the heading)
    +Y  to the left (port)
    +Z  up; a ship's waterline is z = 0

One generic airliner (37.6 m long, the A320's length) and one generic cargo
ship (200 m): the tracker scales each instance to the craft's own reported
or typical length, so the claim the model makes is the right SIZE beside the
ground, not the right type. Stdlib only, deterministic.
"""

import importlib.util
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("satbake", HERE / "bake-satellite-model.py")
satbake = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(satbake)
Mesh = satbake.Mesh
OUT = satbake.OUT

AIRCRAFT_LENGTH_M = 37.6
SHIP_LENGTH_M = 200.0


def centroid(points):
    n = len(points)
    return (sum(p[0] for p in points) / n, sum(p[1] for p in points) / n, sum(p[2] for p in points) / n)


def outward_quad(mesh, a, b, c, d, inside):
    """A quad wound so its normal points away from `inside`."""
    n = satbake.cross(satbake.sub(b, a), satbake.sub(c, a))
    mid = centroid((a, b, c, d))
    to_out = satbake.sub(mid, inside)
    if n[0] * to_out[0] + n[1] * to_out[1] + n[2] * to_out[2] < 0:
        a, b, c, d = a, d, c, b
    mesh.quad(a, b, c, d)


def outward_tri(mesh, a, b, c, inside):
    n = satbake.cross(satbake.sub(b, a), satbake.sub(c, a))
    to_out = satbake.sub(centroid((a, b, c)), inside)
    if n[0] * to_out[0] + n[1] * to_out[1] + n[2] * to_out[2] < 0:
        b, c = c, b
    mesh.tri(a, b, c)


def loft_x(mesh, sections, caps=True):
    """
    A solid lofted along X through closed cross-sections. Each section is
    (x, [(y, z), ...]) with the same number of points; consecutive sections
    are joined by quads, each wound away from the local axis (the mean of the
    two sections' centroids), which is outward for any star-shaped section.
    """
    rings = [[(x, y, z) for (y, z) in pts] for x, pts in sections]
    centres = [centroid(r) for r in rings]
    count = len(rings[0])
    for k in range(len(rings) - 1):
        r0, r1 = rings[k], rings[k + 1]
        inside = tuple((centres[k][i] + centres[k + 1][i]) / 2 for i in range(3))
        for i in range(count):
            j = (i + 1) % count
            outward_quad(mesh, r0[i], r0[j], r1[j], r1[i], inside)
    if caps:
        for k, other in ((0, 1), (len(rings) - 1, len(rings) - 2)):
            # The cap faces away from the next section in.
            ring, c, inside = rings[k], centres[k], centres[other]
            for i in range(count):
                outward_tri(mesh, c, ring[i], ring[(i + 1) % count], inside)


def ellipse(cy, cz, ry, rz, n=14):
    return [(cy + ry * math.cos(2 * math.pi * i / n), cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]


def hexa(mesh, pts):
    """A convex hexahedron: pts[0..3] one face, pts[4..7] the opposite, in matching order."""
    inside = centroid(pts)
    a, b, c, d, e, f, g, h = pts
    for quad in ((a, b, c, d), (e, f, g, h), (a, b, f, e), (b, c, g, f), (c, d, h, g), (d, a, e, h)):
        outward_quad(mesh, *quad, inside)


def panel(mesh, corners, thickness, axis):
    """A flat four-cornered plate, `thickness` along `axis` (0 x, 1 y, 2 z)."""
    lo, hi = [], []
    for p in corners:
        q0, q1 = list(p), list(p)
        q0[axis] -= thickness / 2
        q1[axis] += thickness / 2
        lo.append(tuple(q0))
        hi.append(tuple(q1))
    hexa(mesh, lo + hi)


def build_aircraft():
    half = AIRCRAFT_LENGTH_M / 2  # 18.8
    body = Mesh()
    # Fuselage: a radius profile from nose to tail, the tail cone rising.
    profile = [
        (half, 0.05, 0.0), (half - 1.0, 1.15, -0.1), (half - 2.6, 1.85, 0.0), (half - 5.0, 2.0, 0.0),
        (-8.0, 2.0, 0.0), (-12.0, 1.75, 0.25), (-15.5, 1.15, 0.7), (-18.0, 0.45, 1.15), (-half, 0.15, 1.3),
    ]
    loft_x(body, [(x, ellipse(0.0, cz, r, r * 1.06)) for x, r, cz in profile])
    # Horizontal stabilisers, swept.
    for s in (1, -1):
        panel(body, [(-12.6, s * 1.1, 0.9), (-16.8, s * 1.1, 0.9), (-18.0, s * 6.2, 1.4), (-16.2, s * 6.2, 1.4)], 0.22, 2)

    wings = Mesh()
    for s in (1, -1):
        # A swept, tapered wing: root chord 7 m at the fuselage, tip 2 m at 17 m.
        root_le, root_te, tip_le, tip_te = (4.5, s * 1.8, -1.1), (-3.0, s * 1.8, -1.1), (-5.6, s * 17.0, -0.2), (-7.6, s * 17.0, -0.2)
        lo = [root_le, root_te, tip_te, tip_le]
        hi = [(p[0], p[1], p[2] + (0.55 if abs(p[1]) < 5 else 0.18)) for p in lo]
        hexa(wings, lo + hi)
        # A winglet.
        panel(wings, [(-5.6, s * 17.0, -0.1), (-7.6, s * 17.0, -0.1), (-8.3, s * 17.2, 2.2), (-7.4, s * 17.2, 2.2)], 0.12, 1)
        # An engine under each wing: a nacelle with a pylon.
        loft_x(wings, [(x, ellipse(s * 5.8, -2.1, r, r)) for x, r in ((6.6, 0.95), (6.3, 1.1), (3.0, 1.05), (1.4, 0.75))])
        panel(wings, [(4.2, s * 5.8, -1.2), (1.0, s * 5.8, -1.2), (0.6, s * 5.8, -0.9), (3.6, s * 5.8, -0.9)], 0.3, 1)

    accent = Mesh()
    # The fin: tall, swept, tinted by the tracker.
    panel(accent, [(-11.4, 0.0, 1.6), (-18.2, 0.0, 1.6), (-18.7, 0.0, 7.6), (-16.2, 0.0, 7.6)], 0.32, 1)

    return {"aircraft_body.stl": body, "aircraft_wings.stl": wings, "aircraft_accent.stl": accent}


def build_ship():
    half = SHIP_LENGTH_M / 2  # 100
    hull = Mesh()

    def section(beam, flare, bottom, deck=12.0, n=10):
        """A U section: flat-ish bottom, sides flaring to the deck edge."""
        pts = []
        for i in range(n + 1):  # the port side, deck to keel
            t = i / n
            pts.append((beam * (1 - t) + flare * t, deck * (1 - t) + bottom * t))
        for i in range(n + 1):  # the starboard side, keel to deck
            t = i / n
            pts.append((-(flare * (1 - t) + beam * t), bottom * (1 - t) + deck * t))
        return pts

    stations = [
        (half, 0.6, 0.4, 4.0, 14.0), (half - 6, 7.0, 2.0, -1.0, 13.0), (half - 18, 13.0, 7.0, -2.0, 12.5),
        (half - 35, 16.0, 12.0, -2.0, 12.0), (-half + 25, 16.0, 12.5, -2.0, 12.0),
        (-half + 8, 15.0, 10.0, -1.0, 12.5), (-half, 13.5, 8.0, 2.0, 13.0),
    ]
    loft_x(hull, [(x, section(b, f, z0, z1)) for x, b, f, z0, z1 in stations])

    deck = Mesh()
    # Accommodation aft, a bridge with wings on top, and the funnel behind.
    deck.box(-74.0, 0.0, 22.0, 7.5, 13.0, 10.0)
    deck.box(-72.0, 0.0, 33.0, 4.5, 16.0, 1.2)
    deck.box(-74.0, 0.0, 34.6, 3.0, 2.0, 0.6)   # the mast base
    deck.cylinder_z(-74.0, 0.0, 35.0, 42.0, 0.35, 8)
    deck.cylinder_z(-88.0, 0.0, 12.0, 38.0, 3.2, 14)
    deck.box(half - 4.0, 0.0, 14.5, 3.0, 3.0, 1.5)  # the forecastle

    cargo = Mesh()
    # Container bays from the bridge to the bow, with gaps, so the deck reads as stacks.
    x = -62.0
    while x < half - 22:
        cargo.box(x - 5.5, 0.0, 16.5, 5.6, 13.6, 4.5)
        x += 12.8
    return {"ship_hull.stl": hull, "ship_deck.stl": deck, "ship_cargo.stl": cargo}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    parts = {**build_aircraft(), **build_ship()}
    for name, mesh in parts.items():
        data = mesh.binary(f"GeoID live traffic model - {name} - metres, +X forward, +Y port, +Z up")
        (OUT / name).write_bytes(data)
        total += len(data)
        lo = [min(p[i] for t in mesh.tris for p in t) for i in range(3)]
        hi = [max(p[i] for t in mesh.tris for p in t) for i in range(3)]
        print(f"{name}: {len(mesh.tris)} triangles, {len(data):,} bytes, x {lo[0]:.1f}..{hi[0]:.1f}, y {lo[1]:.1f}..{hi[1]:.1f}, z {lo[2]:.1f}..{hi[2]:.1f}")
    print(f"total {total:,} bytes in {OUT}")


if __name__ == "__main__":
    main()
