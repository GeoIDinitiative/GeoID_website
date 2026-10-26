#!/usr/bin/env python3
"""Build Earth Flight's light aircraft and helicopter as binary STLs.

    python3 scripts/make-aircraft-stl.py   # writes assets/aircraft/cessna_*.stl and heli_*.stl

WHY GENERATED. The flight sim's ships are STLs (assets/ships/), and the
aircraft was asked for the same way. No aircraft model with a licence that is
clean for commercial use and a clear author could be confirmed from this
machine, so the models are built here instead, from published proportions of
the types -- original geometry, an approximation of each type, not a copy of
any model -- and released with the rest of this repository under its licence
(see assets/aircraft/README.md).

SECOND GENERATION (2026-10-25: "upgrade the models ... hyper realistic").
The first build was ~1,100 triangles a craft: 20-sided lofts through nine
sections, a ten-point airfoil, hexagonal struts. This one keeps the SAME frame
and principal dimensions -- so the GeoID livery decals, the propeller axis
and the rotor hubs in scripts/flightsim.js still land where they did -- and
builds each part properly:

  * fuselages lofted through spline-resampled sections (Catmull-Rom on each
    section parameter), 56 around, so the hull is smooth and passes through
    the same key sections as before;
  * NACA 4-digit airfoils with cosine spacing (2412 wings, 0012 tails and
    rotor blades, 4412 propeller), tapered, twisted, with rounded tips;
  * windows as glass patches lying ON the hull (sampled from the same
    superellipse), not a shell over it, with door seams as raised strips;
  * gear with tyres and spats, streamlined struts, antennas, a pitot, a
    landing light and red / green / white navigation lights.

Every closed part is checked by its signed volume and flipped if it came out
inside-out, because the sim draws front faces only. The loader
(loadBakedGeometry in scripts/flightsim.js) rebuilds smooth normals with a
crease angle, which an STL cannot carry.

Frame: metres; nose toward -Z, up +Y, right +X. One STL per material.
"""
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "aircraft"
TAU = 2 * math.pi


# ── Mesh ───────────────────────────────────────────────────────────────────

class Mesh:
    def __init__(self):
        self.tris = []

    def tri(self, a, b, c):
        self.tris.append((tuple(a), tuple(b), tuple(c)))

    def quad(self, a, b, c, d):
        self.tri(a, b, c)
        self.tri(a, c, d)

    def add(self, other):
        self.tris.extend(other.tris)

    def volume(self):
        v = 0.0
        for a, b, c in self.tris:
            v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                  + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
        return v

    def flipped(self):
        m = Mesh()
        m.tris = [(a, c, b) for a, b, c in self.tris]
        return m

    def write(self, path):
        with open(path, "wb") as f:
            f.write(b"GeoID Earth Flight aircraft v2".ljust(80, b" "))
            f.write(struct.pack("<I", len(self.tris)))
            for a, b, c in self.tris:
                ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
                vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
                nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
                f.write(struct.pack("<12fH", nx / ln, ny / ln, nz / ln, *a, *b, *c, 0))


def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def norm(a):
    ln = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / ln, a[1] / ln, a[2] / ln)


def solid(target, build):
    """Build a closed part in a scratch mesh and add it outward-facing."""
    m = Mesh()
    build(m)
    target.add(m if m.volume() >= 0 else m.flipped())


def facing(target, m, outward):
    """Add an open patch so that, on average, it faces `outward`."""
    total = (0.0, 0.0, 0.0)
    for a, b, c in m.tris:
        total = add(total, cross(sub(b, a), sub(c, a)))
    target.add(m if dot(total, outward) >= 0 else m.flipped())


def tube(mesh, rings, cap0=True, cap1=True):
    """Quads between consecutive rings (same length), fan caps at the ends."""
    n = len(rings[0])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            mesh.quad(r0[i], r0[j], r1[j], r1[i])
    for ring, first, on in ((rings[0], True, cap0), (rings[-1], False, cap1)):
        if not on:
            continue
        c = tuple(sum(p[k] for p in ring) / n for k in range(3))
        for i in range(n):
            j = (i + 1) % n
            if first:
                mesh.tri(c, ring[j], ring[i])
            else:
                mesh.tri(c, ring[i], ring[j])


# ── Hulls: superellipse sections through spline-resampled keys ─────────────

def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


class Hull:
    """A body of superellipse sections (z, cx, cy, half_w, half_h, power),
    interpolated smoothly in z, so windows and fittings can sit ON it."""

    def __init__(self, keys):
        self.keys = keys

    def at(self, z):
        k = self.keys
        if z <= k[0][0]:
            return k[0]
        if z >= k[-1][0]:
            return k[-1]
        for i in range(len(k) - 1):
            if k[i][0] <= z <= k[i + 1][0]:
                t = (z - k[i][0]) / (k[i + 1][0] - k[i][0])
                p0, p1, p2, p3 = k[max(0, i - 1)], k[i], k[i + 1], k[min(len(k) - 1, i + 2)]
                return (z, *[catmull(p0[j], p1[j], p2[j], p3[j], t) for j in range(1, 6)])
        return k[-1]

    def point(self, z, t):
        _, cx, cy, hw, hh, pw = self.at(z)
        c, s = math.cos(t), math.sin(t)
        return (cx + hw * math.copysign(abs(c) ** (2 / pw), c), cy + hh * math.copysign(abs(s) ** (2 / pw), s), z)

    def side_x(self, z, y):
        """Half-width of the hull at height y (the right flank, x > 0)."""
        _, cx, cy, hw, hh, pw = self.at(z)
        q = min(1.0, abs((y - cy) / hh))
        return cx + hw * max(0.0, 1 - q ** pw) ** (1 / pw)

    def build(self, mesh, n_sections, seg):
        z0, z1 = self.keys[0][0], self.keys[-1][0]
        rings = []
        for i in range(n_sections + 1):
            u = 0.5 - 0.5 * math.cos(math.pi * i / n_sections)       # denser at the ends
            z = z0 + (z1 - z0) * u
            rings.append([self.point(z, TAU * j / seg) for j in range(seg)])
        solid(mesh, lambda m: tube(m, rings))


# ── Airfoils and lifting surfaces ──────────────────────────────────────────

def naca(code, n=28):
    """Closed NACA 4-digit loop, (u along the chord 0..1, v up), cosine
    spaced: the upper surface from the trailing edge to the nose, then the
    lower back toward it."""
    m, p, t = int(code[0]) / 100, int(code[1]) / 10, int(code[2:]) / 100

    def thick(x):
        return 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)

    def camber(x):
        if m == 0:
            return 0.0, 0.0
        if x < p:
            return m / p ** 2 * (2 * p * x - x * x), 2 * m / p ** 2 * (p - x)
        return m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x), 2 * m / (1 - p) ** 2 * (p - x)

    xs = [0.5 - 0.5 * math.cos(math.pi * i / n) for i in range(n + 1)]
    up, lo = [], []
    for x in xs:
        yc, dy = camber(x)
        th = math.atan(dy)
        yt = thick(x)
        up.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lo.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    return list(reversed(up)) + lo[1:-1]


def foil_upper(code, u):
    """Height of the upper surface at chord fraction u (for placing decals)."""
    m, p, t = int(code[0]) / 100, int(code[1]) / 10, int(code[2:]) / 100
    yt = 5 * t * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)
    yc = (m / p ** 2 * (2 * p * u - u * u) if u < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * u - u * u)) if m else 0.0
    return yc + yt


def lifting(mesh, foil, stations, vertical=False, thick=1.0, tip_round=True):
    """A wing, tail or blade through `stations` (s, z_le, chord, h, twist_deg):
    s the span coordinate (X, or Y if vertical), h the section's height (or
    its offset in X if vertical). Twist turns the section about its quarter
    chord, nose down for positive. A rounded tip closes the far end."""
    def section(s, zle, chord, h, tw, tscale=1.0):
        a = math.radians(tw)
        pts = []
        for u, v in foil:
            zz, vv = (u - 0.25) * chord, v * chord * thick * tscale
            zr = zz * math.cos(a) - vv * math.sin(a)
            vr = zz * math.sin(a) + vv * math.cos(a)
            z = zle + 0.25 * chord + zr
            pts.append((h + vr, s, z) if vertical else (s, h + vr, z))
        return pts
    rings = [section(*st) for st in stations]
    if tip_round:
        s0, z0, c0, h0, t0 = stations[-1]
        direction = 1 if s0 > stations[-2][0] else -1
        for ds, sc, ts in ((0.035, 0.94, 0.80), (0.065, 0.78, 0.50), (0.08, 0.55, 0.22)):
            c = c0 * sc
            rings.append(section(s0 + direction * ds * c0, z0 + (c0 - c) * 0.35, c, h0, t0, ts))
    solid(mesh, lambda m: tube(m, rings))


def prism(mesh, p0, p1, a, b, sides=12, along=(0, 0, 1)):
    """A strut or bar from p0 to p1: elliptical section, semi-axis `a` along
    `along` (streamwise for a strut), `b` across it."""
    d = norm(sub(p1, p0))
    u = sub(along, mul(d, dot(along, d)))
    if dot(u, u) < 1e-9:
        u = (1, 0, 0) if abs(d[0]) < 0.9 else (0, 1, 0)
    u = norm(u)
    v = cross(d, u)

    def ring(p):
        return [add(p, add(mul(u, a * math.cos(TAU * i / sides)), mul(v, b * math.sin(TAU * i / sides)))) for i in range(sides)]
    solid(mesh, lambda m: tube(m, [ring(p0), ring(p1)]))


def sweep(mesh, path, r, sides=12):
    """A round tube along a polyline (skids, exhausts, cross tubes)."""
    rings = []
    for i, p in enumerate(path):
        d = norm(sub(path[min(len(path) - 1, i + 1)], path[max(0, i - 1)]))
        up = (0, 1, 0) if abs(d[1]) < 0.9 else (1, 0, 0)
        u = norm(cross(d, up))
        v = cross(u, d)
        rings.append([add(p, add(mul(u, r * math.cos(TAU * k / sides)), mul(v, r * math.sin(TAU * k / sides)))) for k in range(sides)])
    solid(mesh, lambda m: tube(m, rings))


def ellipsoid(mesh, c, rx, ry, rz, seg=20, rings=12):
    pts = []
    for i in range(1, rings):
        ph = math.pi * i / rings
        pts.append([(c[0] + rx * math.sin(ph) * math.cos(TAU * j / seg), c[1] + ry * math.sin(ph) * math.sin(TAU * j / seg),
                     c[2] - rz * math.cos(ph)) for j in range(seg)])

    def build(m):
        tube(m, pts, cap0=False, cap1=False)
        front, back = (c[0], c[1], c[2] - rz), (c[0], c[1], c[2] + rz)
        for j in range(seg):
            k = (j + 1) % seg
            m.tri(front, pts[0][k], pts[0][j])
            m.tri(back, pts[-1][j], pts[-1][k])
    solid(mesh, build)


def wheel(tyre_mesh, hub_mesh, c, r, w, sides=28):
    """A tyre about the X axis (a rounded section) and its hub discs."""
    rings = []
    for k in range(9):
        t = math.pi * k / 8 - math.pi / 2
        x = c[0] + (w / 2) * math.sin(t)
        rr = r - (w * 0.45) * (1 - math.cos(t))
        rings.append([(x, c[1] + rr * math.cos(TAU * i / sides), c[2] + rr * math.sin(TAU * i / sides)) for i in range(sides)])
    solid(tyre_mesh, lambda m: tube(m, rings))
    for sgn in (-1, 1):
        x = c[0] + sgn * w * 0.5
        prism(hub_mesh, (x - sgn * 0.01, c[1], c[2]), (x + sgn * 0.006, c[1], c[2]), r * 0.5, r * 0.5, sides=18, along=(0, 1, 0))


def hull_patch(target, hull, side, z0, z1, ylo, yhi, offset=0.006, nz=12, ny=6, corner=0.0):
    """A window or panel lying on the hull's flank (side +1 right, -1 left):
    z from z0 to z1, y from ylo(z) to yhi(z) (callables or numbers), lifted
    `offset` off the surface, its corners rounded by `corner` metres."""
    yl = ylo if callable(ylo) else (lambda z, v=ylo: v)
    yh = yhi if callable(yhi) else (lambda z, v=yhi: v)
    m = Mesh()
    grid = []
    for i in range(nz + 1):
        z = z0 + (z1 - z0) * i / nz
        pull = 0.0
        if corner:
            e = min(1.0, min(z - z0, z1 - z) / corner)
            pull = corner * (1 - math.sqrt(max(0.0, 1 - (1 - e) ** 2)))
        a, b = yl(z) + pull, yh(z) - pull
        grid.append([(side * (hull.side_x(z, a + (b - a) * j / ny) + offset), a + (b - a) * j / ny, z) for j in range(ny + 1)])
    for i in range(nz):
        for j in range(ny):
            m.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
    facing(target, m, (side, 0, 0))


def hull_seam(target, hull, side, pts, width=0.012, offset=0.004):
    """A raised seam (door edges) along the flank through (z, y) points."""
    for (za, ya), (zb, yb) in zip(pts, pts[1:]):
        steps = max(1, int(math.hypot(zb - za, yb - ya) / 0.08))
        for k in range(steps):
            z0, y0 = za + (zb - za) * k / steps, ya + (yb - ya) * k / steps
            z1, y1 = za + (zb - za) * (k + 1) / steps, ya + (yb - ya) * (k + 1) / steps
            p0 = (side * (hull.side_x(z0, y0) + offset), y0, z0)
            p1 = (side * (hull.side_x(z1, y1) + offset), y1, z1)
            prism(target, p0, p1, width / 2, width / 2, sides=4, along=(side, 0, 0))


def canopy(target, hull, z0, z1, t0, t1, lift, outward, nz=12, nt=16):
    """Glass over the top of the hull between two section angles."""
    m = Mesh()
    rows = []
    for i in range(nz + 1):
        z = z0 + (z1 - z0) * i / nz
        rows.append([hull.point(z, t0 + (t1 - t0) * j / nt) for j in range(nt + 1)])
    rows = [[(p[0] * (1 + lift), p[1] + lift * 0.5, p[2]) for p in r] for r in rows]
    for a, b in zip(rows, rows[1:]):
        for j in range(nt):
            m.quad(a[j], a[j + 1], b[j + 1], b[j])
    facing(target, m, outward)
    return rows


# ── Light aircraft (Cessna 172-class) ───────────────────────────────────────

C_WING_Y = 1.18          # wing root height, at the cabin roof
C_WING_LE = -1.95
C_CHORD = 1.62
C_INBOARD = 2.6          # constant chord to here, tapered beyond
C_TIP_X = 5.42
C_TIP_CHORD = 1.12
C_DIHEDRAL = math.radians(1.7)


def c_wing_y(x):
    return C_WING_Y + abs(x) * math.tan(C_DIHEDRAL)


def c_chord(x):
    return C_CHORD + (C_TIP_CHORD - C_CHORD) * max(0.0, (abs(x) - C_INBOARD) / (C_TIP_X - C_INBOARD))


def c_le(x):
    return C_WING_LE + (C_CHORD - c_chord(x)) * 0.25      # a straight quarter-chord line


def build():
    hull, trim, glass, prop = Mesh(), Mesh(), Mesh(), Mesh()
    navred, navgreen, navwhite = Mesh(), Mesh(), Mesh()
    # Fuselage. The keys are the first build's sections (so the livery and
    # the wing root still fit) plus a cowling front.
    body = Hull([
        (-4.02, 0, 0.05, 0.27, 0.27, 2.2),
        (-3.92, 0, 0.06, 0.40, 0.37, 2.3),
        (-3.70, 0, 0.08, 0.50, 0.45, 2.4),
        (-3.00, 0, 0.12, 0.56, 0.55, 2.8),
        (-2.40, 0, 0.30, 0.58, 0.80, 3.2),
        (-1.20, 0, 0.32, 0.60, 0.86, 3.4),
        (0.20, 0, 0.28, 0.56, 0.80, 3.2),
        (1.20, 0, 0.30, 0.42, 0.55, 2.8),
        (2.60, 0, 0.40, 0.25, 0.34, 2.4),
        (3.90, 0, 0.50, 0.12, 0.20, 2.2),
        (4.30, 0, 0.52, 0.06, 0.10, 2.0),
    ])
    body.build(hull, 64, 56)

    # Wings: NACA 2412, constant chord inboard, tapered outboard, 1.7 deg of
    # dihedral, 1.5 deg of washout over the outer metre, rounded tips.
    foil = naca("2412", 30)
    for side in (-1, 1):
        st = [(side * x, c_le(x), c_chord(x), c_wing_y(x), 1.5 * max(0.0, (x - 4.2) / (C_TIP_X - 4.2)))
              for x in (0.0, 1.0, 2.0, C_INBOARD, 3.4, 4.2, 4.9, C_TIP_X)]
        lifting(hull, foil, st)
        # Flap and aileron hinge lines on the upper skin, at 74 % chord.
        for xa, xb in ((0.62, 2.95), (3.05, 5.15)):
            ends = [(side * x, c_wing_y(x) + foil_upper("2412", 0.74) * c_chord(x) + 0.002, c_le(x) + 0.74 * c_chord(x)) for x in (xa, xb)]
            prism(trim, ends[0], ends[1], 0.006, 0.0035, sides=4, along=(0, 1, 0))
        # Strut: a streamlined (elliptical) section from the fuselage to the wing.
        prism(trim, (side * 0.56, -0.30, -1.22), (side * 2.6, c_wing_y(2.6) - 0.05, -1.30), 0.055, 0.016, sides=14)
        # Navigation light at the tip: red left, green right.
        ellipsoid(navred if side < 0 else navgreen, (side * 5.55, c_wing_y(5.5) + 0.01, c_le(5.42) + 0.12), 0.035, 0.035, 0.07, seg=12, rings=8)
    # Landing light in the left wing's leading edge.
    ellipsoid(glass, (-1.85, c_wing_y(1.85) + 0.005, C_WING_LE + 0.012), 0.11, 0.04, 0.03, seg=14, rings=6)

    # Tail: stabiliser and fin (NACA 0012) with hinge lines, a dorsal fillet.
    tfoil = naca("0012", 22)
    for side in (-1, 1):
        lifting(hull, tfoil, [(side * x, 3.35 + 0.15 * x / 1.7, 0.95 * (1 - 0.25 * x / 1.7), 0.52, 0.0) for x in (0.0, 0.6, 1.2, 1.62)], thick=0.8)
        prism(trim, (side * 0.14, 0.52 + 0.04, 3.35 + 0.95 * 0.66), (side * 1.55, 0.52 + 0.035, 3.35 + 0.137 + 0.95 * 0.78 * 0.66), 0.005, 0.004, sides=4, along=(0, 1, 0))
    lifting(hull, tfoil, [(y, 3.0 + 0.55 * (y - 0.55) / 1.3, 1.25 * (1 - 0.45 * (y - 0.55) / 1.3), 0.0, 0.0) for y in (0.45, 0.9, 1.4, 1.82)], vertical=True, thick=0.7)
    lifting(hull, tfoil, [(y, 2.05 + 0.95 * (y - 0.52) / 0.42, 1.45 - 0.95 * (y - 0.52) / 0.42, 0.0, 0.0) for y in (0.52, 0.70, 0.94)], vertical=True, thick=0.45, tip_round=False)
    ellipsoid(navwhite, (0, 0.52, 4.36), 0.03, 0.03, 0.045, seg=10, rings=6)

    # Cowling: air intakes either side of the spinner, an exhaust stub below.
    for side in (-1, 1):
        ellipsoid(trim, (side * 0.16, -0.05, -3.99), 0.08, 0.05, 0.03, seg=16, rings=6)
    sweep(trim, [(0.18, -0.34, -3.55), (0.20, -0.40, -3.35), (0.21, -0.42, -3.15)], 0.032, sides=10)

    # Glass: windscreen, door windows and rear windows, ON the hull.
    canopy(glass, body, -2.62, -2.02, math.radians(32), math.radians(148), 0.012, (0, 1, -1))
    for side in (-1, 1):
        hull_patch(glass, body, side, -2.10, -1.18, lambda z: 0.62 + 0.04 * (z + 2.10), 1.08, corner=0.08)
        hull_patch(glass, body, side, -1.08, -0.35, 0.64, lambda z: 1.08 - 0.10 * (z + 1.08), corner=0.07)
        hull_patch(glass, body, side, -0.25, 0.55, 0.70, lambda z: 1.02 - 0.32 * (z + 0.25), corner=0.06)
        hull_seam(trim, body, side, [(-2.22, 0.05), (-2.22, 1.10), (-1.12, 1.10), (-1.12, 0.05), (-2.22, 0.05)])
        prism(trim, (side * 0.55, -0.40, -0.95), (side * 0.80, -0.62, -0.95), 0.03, 0.012, sides=6)       # step

    # Gear: spring-steel main legs, tyres with spats; nose oleo and spat.
    for side in (-1, 1):
        prism(trim, (side * 0.48, -0.38, -0.72), (side * 1.10, -1.00, -0.66), 0.055, 0.016, sides=8)
        wheel(trim, hull, (side * 1.15, -1.12, -0.65), 0.28, 0.15)
        ellipsoid(hull, (side * 1.15, -1.04, -0.60), 0.12, 0.22, 0.52, seg=22, rings=14)
    prism(trim, (0, -0.22, -3.22), (0, -0.84, -3.30), 0.035, 0.035, sides=12)
    wheel(trim, hull, (0, -1.12, -3.30), 0.22, 0.12)
    ellipsoid(hull, (0, -1.04, -3.27), 0.10, 0.19, 0.42, seg=20, rings=12)

    # Antennas and pitot.
    prism(trim, (0, 1.17, -0.40), (0, 1.62, -0.05), 0.012, 0.006, sides=6)
    prism(trim, (0, 1.06, 0.55), (0, 1.30, 0.70), 0.03, 0.006, sides=6)
    prism(trim, (-3.4, c_wing_y(3.4) - 0.09, -1.80), (-3.4, c_wing_y(3.4) - 0.09, -2.15), 0.008, 0.008, sides=8)

    # Propeller about the nose axis (x 0, y 0.05): a parabolic spinner and two
    # twisted blades on a 4412 section, 1.9 m across.
    spin = [[(0.21 * math.sqrt(max(0.0, 1 - (1 - u) ** 2)) * math.cos(TAU * j / 32),
              0.05 + 0.21 * math.sqrt(max(0.0, 1 - (1 - u) ** 2)) * math.sin(TAU * j / 32),
              -4.46 + 0.42 * u) for j in range(32)] for u in [i / 16 for i in range(1, 17)]]
    tip = (0.0, 0.05, -4.46)

    def spinner(m):
        tube(m, spin, cap0=False, cap1=True)
        for j in range(32):
            m.tri(tip, spin[0][(j + 1) % 32], spin[0][j])
    solid(prop, spinner)
    pfoil = naca("4412", 18)
    for side in (-1, 1):
        st = []
        for r in (0.17, 0.30, 0.50, 0.70, 0.86, 0.93):
            chord = 0.10 + 0.07 * math.sin(math.pi * min(1.0, (r - 0.10) / 0.95))
            st.append((side * r, -4.22 - chord * 0.25, chord, 0.05, side * (38 - 26 * (r - 0.17) / 0.76)))
        lifting(prop, pfoil, st, thick=0.9)

    # Where the wing livery lands now (scripts/flightsim.js buildAircraft).
    x, u = 2.75, 0.475
    print(f"  cessna wing decal: y {c_wing_y(x) + foil_upper('2412', u) * c_chord(x) + 0.012:.3f} at x {x}, z {c_le(x) + u * c_chord(x):.3f}")
    return {"hull": hull, "trim": trim, "glass": glass, "prop": prop,
            "navred": navred, "navgreen": navgreen, "navwhite": navwhite}


# ── Helicopter (Bell 206-class) ─────────────────────────────────────────────

def build_helicopter():
    """Bell 206-class: 9.5 m fuselage, 10.2 m main rotor, 1.6 m tail rotor,
    skids. The rotors are built about their OWN hubs (main axis +Y, tail axis
    +X) so the sim spins them in place at HELI_MAIN_HUB and HELI_TAIL_HUB."""
    hull, trim, glass, rotor, tail = Mesh(), Mesh(), Mesh(), Mesh(), Mesh()
    navred, navgreen, navwhite = Mesh(), Mesh(), Mesh()
    pod = Hull([
        (-3.00, 0, 0.80, 0.18, 0.20, 2.2),
        (-2.85, 0, 0.79, 0.38, 0.42, 2.3),
        (-2.70, 0, 0.78, 0.50, 0.55, 2.4),
        (-2.00, 0, 0.82, 0.70, 0.80, 2.8),
        (-0.80, 0, 0.88, 0.76, 0.90, 3.2),
        (0.50, 0, 0.92, 0.66, 0.82, 3.0),
        (1.25, 0, 1.05, 0.36, 0.48, 2.6),
        (2.20, 0, 1.12, 0.22, 0.26, 2.2),
        (4.50, 0, 1.22, 0.15, 0.17, 2.0),
        (6.30, 0, 1.30, 0.10, 0.12, 2.0),
    ])
    pod.build(hull, 72, 56)
    # Engine and transmission fairing, intake grilles, exhaust stack.
    cowl = Hull([
        (-0.75, 0, 1.70, 0.14, 0.06, 2.0),
        (-0.55, 0, 1.76, 0.30, 0.17, 2.4),
        (-0.30, 0, 1.80, 0.36, 0.22, 2.6),
        (0.90, 0, 1.78, 0.34, 0.22, 2.6),
        (1.40, 0, 1.68, 0.22, 0.14, 2.2),
        (1.62, 0, 1.60, 0.10, 0.06, 2.0),
    ])
    cowl.build(hull, 30, 40)
    for side in (-1, 1):
        hull_patch(trim, cowl, side, -0.10, 0.35, 1.70, 1.86, offset=0.004, nz=6, ny=3, corner=0.03)
    sweep(trim, [(0.0, 1.88, 1.05), (0.0, 1.98, 1.22), (0.0, 2.05, 1.40)], 0.10, sides=16)
    # Tail: fins above and below the boom end, a tailplane with endplates,
    # the tail rotor gearbox, the driveshaft cover along the boom.
    tfoil = naca("0012", 22)
    lifting(hull, tfoil, [(y, 5.55 + 0.35 * (y - 1.20) / 1.10, 0.75 * (1 - 0.4 * (y - 1.20) / 1.10), 0.0, 0.0) for y in (1.20, 1.70, 2.30)], vertical=True, thick=0.7)
    lifting(hull, tfoil, [(y, 5.70 + 0.10 * (1.20 - y) / 0.65, 0.55 * (1 - 0.3 * (1.20 - y) / 0.65), 0.0, 0.0) for y in (1.20, 0.85, 0.55)], vertical=True, thick=0.7)
    for side in (-1, 1):
        lifting(hull, naca("2412", 18), [(side * x, 4.70, 0.42 * (1 - 0.3 * x / 0.8), 1.22, 0.0) for x in (0.0, 0.5, 0.8)], thick=0.8, tip_round=False)
        lifting(hull, tfoil, [(y, 4.66, 0.40, side * 0.81, 0.0) for y in (1.02, 1.42)], vertical=True, thick=0.6, tip_round=False)
    ellipsoid(hull, (0.10, 1.32, 6.30), 0.16, 0.18, 0.22, seg=18, rings=10)
    sweep(hull, [(0, 1.30, 1.40), (0, 1.36, 3.0), (0, 1.39, 4.6), (0, 1.41, 6.05)], 0.07, sides=12)
    # Glass: the bubble windscreen with a centre post, chin windows, doors.
    rows = canopy(glass, pod, -2.98, -1.23, math.radians(12), math.radians(168), 0.012, (0, 0.6, -1), nz=14, nt=22)
    sweep(hull, [(0.0, r[11][1] + 0.02, r[11][2]) for r in rows], 0.035, sides=8)
    for side in (-1, 1):
        hull_patch(glass, pod, side, -2.80, -2.05, 0.30, 0.68, corner=0.07)
        hull_patch(glass, pod, side, -1.85, -1.00, 0.95, 1.50, corner=0.08)
        hull_patch(glass, pod, side, -0.75, 0.15, 0.98, 1.45, corner=0.08)
        hull_seam(trim, pod, side, [(-1.92, 0.25), (-1.92, 1.56), (-0.93, 1.56), (-0.93, 0.25)])
        hull_seam(trim, pod, side, [(-0.82, 0.25), (-0.82, 1.52), (0.22, 1.52), (0.22, 0.25)])
        # Skids: a tube with an upturned toe, two arched cross tubes, a step.
        x = side * 1.10
        sweep(trim, [(x, -0.10, -2.35), (x, -0.24, -2.14), (x, -0.30, -1.82), (x, -0.30, 1.55), (x, -0.27, 1.70)], 0.045, sides=12)
        for z in (-1.05, 0.75):
            sweep(trim, [(side * 0.45, 0.25, z), (side * 0.80, 0.10, z), (side * 1.02, -0.12, z), (x, -0.28, z)], 0.042, sides=10)
        prism(trim, (x * 0.95, -0.12, -0.45), (x * 0.95, -0.12, 0.05), 0.10, 0.02, sides=8, along=(1, 0, 0))
        ellipsoid(navred if side < 0 else navgreen, (side * 0.82, 1.40, 4.66), 0.03, 0.03, 0.05, seg=10, rings=6)
    ellipsoid(navwhite, (0, 1.30, 6.55), 0.03, 0.03, 0.04, seg=10, rings=6)
    # Mast, antenna, tail rotor guard.
    prism(trim, (0, 1.95, -0.30), (0, 2.38, -0.30), 0.09, 0.09, sides=16)
    prism(trim, (0, 0.05, -0.6), (0, -0.30, -0.4), 0.012, 0.006, sides=6)
    sweep(hull, [(0.0, 0.70, 5.75), (0.0, 0.52, 6.10), (0.0, 0.56, 6.55), (0.0, 0.80, 6.70)], 0.03, sides=8)

    # Main rotor about its hub (axis +Y): hub, pitch links, two blades along X,
    # NACA 0012, 8 deg of linear twist, rounded tips.
    ellipsoid(rotor, (0, 0, 0), 0.24, 0.10, 0.24, seg=20, rings=8)
    prism(rotor, (0, -0.25, 0), (0, 0.12, 0), 0.07, 0.07, sides=14)
    for side in (-1, 1):
        prism(rotor, (side * 0.16, -0.18, 0.05), (side * 0.16, 0.0, 0.08), 0.012, 0.012, sides=6)
        lifting(rotor, tfoil, [(side * r, -0.15, 0.33, 0.02, side * (4 - 8 * (r - 0.25) / 4.85)) for r in (0.25, 0.6, 1.5, 2.5, 3.5, 4.4, 5.05)], thick=0.9)
    # Tail rotor about its hub (axis +X): a hub and two blades along Y.
    prism(tail, (-0.08, 0, 0), (0.08, 0, 0), 0.07, 0.07, sides=12, along=(0, 1, 0))
    for side in (-1, 1):
        lifting(tail, tfoil, [(side * r, -0.09, 0.18, 0.0, 0.0) for r in (0.06, 0.4, 0.78)], vertical=True, thick=0.6)
    return {"hull": hull, "trim": trim, "glass": glass, "rotor": rotor, "tailrotor": tail,
            "navred": navred, "navgreen": navgreen, "navwhite": navwhite}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for prefix, parts in (("cessna", build()), ("heli", build_helicopter())):
        for name, mesh in parts.items():
            path = OUT / f"{prefix}_{name}.stl"
            mesh.write(path)
            total += len(mesh.tris)
            print(f"{path.relative_to(OUT.parent.parent)}  {len(mesh.tris)} triangles  {path.stat().st_size} bytes")
    print(f"{total} triangles in all")


if __name__ == "__main__":
    main()
