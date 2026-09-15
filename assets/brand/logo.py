"""
The GeoID mark and wordmark, drawn rather than traced.

THE MARK IS A REAL SPHERE. Each band is the front half of a LATITUDE ZONE on a
globe whose pole leans toward the eye, so its curve, its length and the angle
of its cut ends are all consequences of one construction rather than choices
taken arc by arc. That is what makes the circle read as a sphere instead of a
stack of smiles, and it is why the shape holds at any size: there is nothing
hand-placed in it to go soft.

    a latitude ring at phi, on a sphere whose pole leans TAU toward the eye,
    projects to an ellipse centred at (0, R sin phi cos TAU) with semi-axes
    (R cos phi, R cos phi sin TAU); the half nearest the eye is its lower half,
    and that half is the band.

A zone between phi-d and phi+d is bounded by two such arcs, and each end of it
is closed on the limb, so the bands that reach the edge ARE the edge.

THE COLOUR IS TWO THINGS, NOT ONE RAMP. A cool magenta-to-cyan gradient runs
down the sphere -- the viewer skin's own two colours, #ff2bd6 and #00e5ff, at
its ends -- and a warm light is laid over it at one point near the equator.
Putting the amber into the ramp itself is what muddies a mark like this: a
gradient cannot travel magenta - violet - blue AND pass through orange without
going through grey somewhere. Laid over as light, the warmth reads as a sunrise
at the limb and leaves the ramp clean.
"""
import cairo
import math

TAU = math.radians(23.44)     # the pole's lean toward the eye -- Earth's own
ROLL = math.radians(-8.0)     # a turn in the screen plane, for movement
ZONE = 6.0                    # half-height of each zone, degrees
# The latitudes are SOLVED, not chosen. A band's arc bottoms out at
# sin(psi - TAU), so asking for a 0.025-radius dark cap at each pole fixes the
# outermost edges, and the rest divide that span evenly. Even spacing in
# latitude would crowd the poles; even spacing on screen would flatten the
# sphere back into a stack of lines. This is the pair of constraints that
# leaves the bands evenly stepped AND the globe legible.
LATS = [78.8, 60.3, 41.9, 23.4, 5.0, -13.5, -31.9]
SUN = (0.30, 0.09)            # the warm light, in sphere radii from centre

# THE SILHOUETTE IS A CIRCLE, AND CROPPING IS WHAT BUYS IT. A band's ends sit
# at (cos psi, sin psi cos TAU), so left alone they trace an ellipse 1/cos(TAU)
# wider than tall -- an egg, which is the first thing an eye notices and the
# last thing it forgives.
#
# Stretching y to fix that was tried and is wrong: the front arc of a ring at
# psi reaches down to sin(psi - TAU), which already touches the unit circle at
# psi = TAU - 90, so stretching drives the southern bands straight out through
# their own limb. What works is the other direction -- draw the sphere LARGER
# than the mark and let a circle of CROP of its radius cut every band end. At
# 0.90 every end from the equator to 81 degrees falls outside that circle, so
# each one is cut by the limb rather than stopping short of it, and the mark's
# edge is the circle everywhere a band reaches it.
CROP = 0.90
SPHERE = 1.0 / CROP

RAMP = [
    (0.00, (1.000, 0.310, 0.690)),
    (0.20, (0.918, 0.251, 0.812)),
    (0.40, (0.659, 0.333, 0.965)),
    (0.60, (0.357, 0.486, 0.980)),
    (0.80, (0.169, 0.561, 0.961)),
    (1.00, (0.000, 0.898, 1.000)),
]
GLOW = [
    (0.00, (1.000, 0.949, 0.694, 0.97)),
    (0.16, (1.000, 0.847, 0.435, 0.93)),
    (0.34, (1.000, 0.706, 0.267, 0.84)),
    (0.52, (1.000, 0.502, 0.192, 0.52)),
    (0.78, (0.980, 0.302, 0.322, 0.17)),
    (1.00, (0.900, 0.200, 0.500, 0.00)),
]
GLOW_R = 1.06

INK = (1, 1, 1)
INK_DARK = (0.043, 0.075, 0.137)
NAVY = (0.027, 0.055, 0.106)


def _arc(phi_deg, n=220):
    """The front half of one latitude ring, in sphere radii, y UP."""
    phi = math.radians(phi_deg)
    a = math.cos(phi) * SPHERE
    b = a * math.sin(TAU)
    yc = math.sin(phi) * math.cos(TAU) * SPHERE
    return [(a * math.cos(math.pi + math.pi * i / n),
             yc + b * math.sin(math.pi + math.pi * i / n)) for i in range(n + 1)]


def _rim(psi_from, psi_to, n=48):
    """The limb, from one latitude to another -- a band's cut end."""
    a, b = math.radians(psi_from), math.radians(psi_to)
    return [(math.cos(a + (b - a) * i / n) * SPHERE,
             math.sin(a + (b - a) * i / n) * math.cos(TAU) * SPHERE)
            for i in range(n + 1)]


def _roll(pts):
    c, s = math.cos(ROLL), math.sin(ROLL)
    return [(x * c - y * s, x * s + y * c) for x, y in pts]


def band_path(ctx, phi_deg):
    """One zone: upper edge, right limb, lower edge, left limb."""
    hi, lo = phi_deg + ZONE, phi_deg - ZONE
    pts = (_arc(hi)                                  # left to right, upper
           + _rim(hi, lo)                            # down the right limb
           + list(reversed(_arc(lo)))                # right to left, lower
           + [(-x, y) for x, y in _rim(lo, hi)])     # up the left limb
    pts = _roll(pts)
    ctx.move_to(pts[0][0], -pts[0][1])
    for x, y in pts[1:]:
        ctx.line_to(x, -y)
    ctx.close_path()


def mark(ctx, cx, cy, r, glow=True, flat=None):
    """The sphere, centred at (cx, cy) with radius r."""
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(r, r)
    ctx.new_path()
    ctx.arc(0, 0, 1.0, 0, 2 * math.pi)   # nothing may cross the limb
    ctx.clip()

    for phi in LATS:
        band_path(ctx, phi)
    ctx.set_fill_rule(cairo.FILL_RULE_WINDING)

    if flat is not None:
        ctx.set_source_rgb(*flat)
        ctx.fill()
        ctx.restore()
        return

    ramp = cairo.LinearGradient(0, -1, 0, 1)
    for at, (cr, cg, cb) in RAMP:
        ramp.add_color_stop_rgb(at, cr, cg, cb)
    ctx.set_source(ramp)
    ctx.fill_preserve()

    if glow:
        sun = cairo.RadialGradient(SUN[0], -SUN[1], 0.0, SUN[0], -SUN[1], GLOW_R)
        for at, (cr, cg, cb, ca) in GLOW:
            sun.add_color_stop_rgba(at, cr, cg, cb, ca)
        ctx.set_source(sun)
        ctx.fill()
    else:
        ctx.new_path()
    ctx.restore()


def _face(ctx, size):
    ctx.select_font_face("Montserrat", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    ctx.set_font_size(size)


def wordmark_width(ctx, size, track):
    _face(ctx, size)
    return sum(ctx.text_extents(ch).x_advance + track for ch in "GeoID") - track


def wordmark(ctx, x, y, size, track, ink=INK):
    """`Geo` in ink, `ID` in the ramp, set glyph by glyph for even tracking."""
    _face(ctx, size)
    total = wordmark_width(ctx, size, track)
    # THE RAMP SPANS `ID`, NOT THE WHOLE WORD. Run it end to end and the `I`
    # picks up whatever colour happens to fall at 72% of the width -- a violet
    # already halfway to the blue -- and the two letters carry a third of the
    # range between them. Anchored to the letters it is actually colouring,
    # `I` starts at the magenta and `D` finishes at the blue.
    lead = sum(ctx.text_extents(c).x_advance + track for c in "Geo")
    grad = cairo.LinearGradient(x + lead, 0, x + total, 0)
    grad.add_color_stop_rgb(0.00, 0.949, 0.263, 0.616)
    grad.add_color_stop_rgb(0.48, 0.706, 0.333, 0.949)
    grad.add_color_stop_rgb(1.00, 0.231, 0.545, 0.980)
    pen = x
    for ch in "GeoID":
        ctx.move_to(pen, y)
        ctx.text_path(ch)
        ctx.set_source_rgb(*ink) if ch in "Geo" else ctx.set_source(grad)
        ctx.fill()
        pen += ctx.text_extents(ch).x_advance + track
    return total
