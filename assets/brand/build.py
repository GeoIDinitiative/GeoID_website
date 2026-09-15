"""
Write the GeoID brand kit.

    python3 build.py [outdir]

Every file here comes off the same drawing in `logo.py`, so the favicon and
the 4K lockup cannot drift: there is one artwork and these are its renderings.
The SVGs are that artwork as vector, with the type already converted to
outlines, so they need no font installed and will not reflow on a machine that
lacks Montserrat.
"""
import cairo
import math
import os
import sys
import logo as L

GAP = 0.46      # mark radius units, mark to wordmark
SIZE = 1.30     # wordmark size in mark radius units
TRACK = -0.012  # tracking, as a fraction of the font size
PAD = 0.15      # breathing room, in mark radius units
VGAP = 0.34     # mark to wordmark when stacked

# Fewer, fatter bands below about 48px: seven bands into sixteen pixels is a
# smudge, and an icon that has to be recognised at that size is a different
# drawing of the same idea rather than a shrunk one.
COMPACT = dict(ZONE=8.6, LATS=[75.6, 49.5, 23.4, -2.7, -28.8])
FULL = dict(ZONE=L.ZONE, LATS=L.LATS)


def _probe():
    return cairo.Context(cairo.ImageSurface(cairo.FORMAT_ARGB32, 1, 1))


def metrics(R):
    ctx = _probe()
    size = R * SIZE
    L._face(ctx, size)
    return (L.wordmark_width(ctx, size, size * TRACK),
            -ctx.text_extents("G").y_bearing, size)


def lockup_box(R):
    w, ch, _ = metrics(R)
    return (PAD * R + 2 * R + GAP * R + w + PAD * R, 2 * R + 2 * PAD * R)


def stacked_box(R):
    w, ch, _ = metrics(R)
    return (max(2 * R, w) + 2 * PAD * R, 2 * R + VGAP * R + ch + 2 * PAD * R)


def draw_lockup(ctx, R, ink, glow=True):
    w, ch, size = metrics(R)
    W, H = lockup_box(R)
    L.mark(ctx, PAD * R + R, H / 2, R, glow=glow)
    L.wordmark(ctx, PAD * R + 2 * R + GAP * R, H / 2 + ch / 2, size, size * TRACK, ink=ink)


def draw_stacked(ctx, R, ink, glow=True):
    w, ch, size = metrics(R)
    W, H = stacked_box(R)
    L.mark(ctx, W / 2, PAD * R + R, R, glow=glow)
    L.wordmark(ctx, (W - w) / 2, PAD * R + 2 * R + VGAP * R + ch, size, size * TRACK, ink=ink)


def surface(path, W, H, svg):
    if svg:
        return cairo.SVGSurface(path, W, H)
    return cairo.ImageSurface(cairo.FORMAT_ARGB32, int(round(W)), int(round(H)))


def write(path, W, H, draw, bg=None, scale=1.0):
    svg = path.endswith(".svg")
    surf = surface(path, W * scale, H * scale, svg)
    ctx = cairo.Context(surf)
    ctx.scale(scale, scale)
    if bg:
        ctx.set_source_rgb(*bg)
        ctx.paint()
    draw(ctx)
    if svg:
        surf.finish()
    else:
        surf.write_to_png(path)
    return path


def main(out="out"):
    os.makedirs(out, exist_ok=True)
    p = lambda n: os.path.join(out, n)
    made = []

    # ── the lockup ─────────────────────────────────────────────────────────
    R = 500.0
    W, H = lockup_box(R)
    for name, bg, ink, scale in [
        ("geoid-logo.png", None, L.INK, 4096 / W),
        ("geoid-logo-dark.png", L.NAVY, L.INK, 4096 / W),
        ("geoid-logo-light.png", None, L.INK_DARK, 4096 / W),
        ("geoid-logo-web.png", None, L.INK, 1600 / W),
        ("geoid-logo.svg", None, L.INK, 1.0),
        ("geoid-logo-light.svg", None, L.INK_DARK, 1.0),
    ]:
        made.append(write(p(name), W, H, lambda c, i=ink: draw_lockup(c, R, i), bg, scale))

    # ── stacked, for a square slot ─────────────────────────────────────────
    SW, SH = stacked_box(R)
    for name, bg, ink in [("geoid-logo-stacked.png", None, L.INK),
                          ("geoid-logo-stacked-dark.png", L.NAVY, L.INK),
                          ("geoid-logo-stacked.svg", None, L.INK)]:
        sc = 1.0 if name.endswith(".svg") else 2048 / SW
        made.append(write(p(name), SW, SH, lambda c, i=ink: draw_stacked(c, R, i), bg, sc))

    # ── the mark alone ─────────────────────────────────────────────────────
    for name, bg, sc in [("geoid-mark.png", None, 2048 / 1000.0),
                         ("geoid-mark-dark.png", L.NAVY, 2048 / 1000.0),
                         ("geoid-mark.svg", None, 1.0)]:
        made.append(write(p(name), 1000, 1000,
                          lambda c: L.mark(c, 500, 500, 460), bg, sc))

    # ── icons: navy square, and the mark on nothing ────────────────────────
    for S in (1024, 512, 256, 180, 128, 64, 48, 32, 16):
        vals = COMPACT if S <= 48 else FULL
        L.ZONE, L.LATS = vals["ZONE"], vals["LATS"]
        made.append(write(p(f"geoid-icon-{S}.png"), S, S,
                          lambda c, s=S: L.mark(c, s / 2, s / 2, s * 0.415), L.NAVY))
        if S in (1024, 512, 256):
            made.append(write(p(f"geoid-icon-{S}-clear.png"), S, S,
                              lambda c, s=S: L.mark(c, s / 2, s / 2, s * 0.415)))
    L.ZONE, L.LATS = FULL["ZONE"], FULL["LATS"]

    # A .ico carries several sizes in one file, which is what a browser wants
    # from a favicon: it picks the size it needs instead of resampling one.
    ico = p("geoid-favicon.ico")
    if os.system("convert " + " ".join(p(f"geoid-icon-{s}.png") for s in
                 (16, 32, 48, 64, 128, 256)) + " " + ico + " 2>/dev/null") == 0:
        made.append(ico)
    return made


if __name__ == "__main__":
    for f in main(sys.argv[1] if len(sys.argv) > 1 else "out"):
        print(f"{os.path.getsize(f):>9,}  {f}")
