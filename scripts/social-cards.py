#!/usr/bin/env python3
"""Point every page at its own share card, and keep them pointed there.

    python3 scripts/social-cards.py            # rewrite the tags
    python3 scripts/social-cards.py --check    # exit 1 if any page is stale

WHAT WAS WRONG. Every page carried the same `og:image`: `assets/og_geoid.jpg`,
the logo, at 1200x1200 — and `twitter:card` was `summary`, the small-thumbnail
variant. So every link to this site posted anywhere — LinkedIn, Bluesky,
Slack, Discord, WhatsApp, Teams — rendered as a little square logo. For a
product whose whole appeal is a spinning globe of 312,500 earthquakes, that is
the worst possible advertisement, and it is the one piece of the site that is
seen by people who have not visited it yet.

THE CARDS ARE RENDERED, NOT HAND-DRAWN. `assets/social/*.jpg` are 1200x630
captures of a real page (the template lives with the card generator), so they
use the site's own Archivo, its own #080014 ground and its own #ff3ec8 accent.
Re-render them with the generator rather than editing a JPEG.

1200x630 IS THE NUMBER. It is the aspect every scraper crops to; a square image
is letterboxed or centre-cropped and usually loses the type. `summary_large_image`
is what asks for the big treatment — without it the card is a thumbnail whatever
its size.

WHY A SCRIPT. Same reason as csp.py, breadcrumbs.py and world-paths.py: a tag
that has to agree across thirteen pages will not stay in agreement by hand.
`--check` runs in the test suite.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://geoidinitiative.com"

# page -> (card slug, alt text). The alt is read aloud by screen readers on
# some platforms and shown when the image fails, so it describes the PICTURE,
# not the page.
CARDS = {
    "index.html":               ("home", "The GeoHUB globe, world geology painted over 3D terrain"),
    "about/index.html":         ("about", "Basalt escarpment at Binevenagh, Northern Ireland"),
    "about_geohub/index.html":  ("geohub", "The GeoHUB globe, world geology painted over 3D terrain"),
    "membership/index.html":    ("membership", "A flooded village from the air"),
    "earth_explorer/index.html":("earth-explorer", "Lava channels on the snow-covered flank of Mount Etna"),
    "dashboard/index.html":     ("dashboard", "Global cloud and weather imagery over the Earth"),
    "data/index.html":          ("data", "Earthquake hypocentres beneath Mount Etna as a 3D cloud"),
    "updates/index.html":       ("journal", "A notebook and pen on a desk"),
    "researchers/index.html":   ("researchers", "A terrain surface as a finite-element wireframe"),
    "team/index.html":          ("team", "A volcanic crater floor during fieldwork"),
    "get-involved/index.html":  ("get-involved", "The Milky Way over a dark sky"),
    "contact/index.html":       ("contact", "The Earth from space"),
    "everest/index.html":       ("everest", "The summit of Mount Everest above the surrounding peaks"),
    "fund.html":                ("fund", "A landslide scar on a mountainside, seen from above"),
}


def block(slug, alt):
    url = f"{SITE}/assets/social/{slug}.jpg"
    return (
        f'  <meta property="og:image" content="{url}">\n'
        f'  <meta property="og:image:width" content="1200">\n'
        f'  <meta property="og:image:height" content="630">\n'
        f'  <meta property="og:image:alt" content="{alt}">\n'
    )


OG_RE = re.compile(
    r'[ \t]*<meta property="og:image"[^>]*>\n'
    r'(?:[ \t]*<meta property="og:image:(?:width|height|alt|type|secure_url)"[^>]*>\n)*')
TW_CARD_RE = re.compile(r'([ \t]*<meta name="twitter:card" content=")[^"]*(">)')
TW_IMG_RE = re.compile(r'([ \t]*<meta name="twitter:image" content=")[^"]*(">)')
TW_ALT_RE = re.compile(r'[ \t]*<meta name="twitter:image:alt"[^>]*>\n')


def rewrite(text, slug, alt):
    url = f"{SITE}/assets/social/{slug}.jpg"
    out, n = OG_RE.subn(block(slug, alt), text, count=1)
    if not n:
        return None, "no og:image tag to replace"
    out, n = TW_CARD_RE.subn(r'\g<1>summary_large_image\g<2>', out, count=1)
    if not n:
        return None, "no twitter:card tag"
    out = TW_ALT_RE.sub("", out)
    # Replace twitter:image, then put its alt on the line after it. Building
    # both in one substitution meant escaping quotes inside an f-string inside
    # a lambda, which is how a one-line regex turns into a puzzle.
    m = TW_IMG_RE.search(out)
    if m:
        indent = re.match(r'[ \t]*', m.group(1)).group(0)
        start, end = m.start(), m.end()
    else:
        # /membership/ and /updates/ never had a twitter:image at all — they
        # carried twitter:card and nothing for it to show. Add the pair after
        # the card tag rather than skipping the page, which is what left two
        # of thirteen still advertising the logo.
        c = TW_CARD_RE.search(out)
        if not c:
            return None, "no twitter:card tag to anchor the image to"
        indent = re.match(r'[ \t]*', c.group(1)).group(0)
        # after the card tag AND after its newline, or the two tags share a line
        nl = out.find("\n", c.end())
        start = end = (nl + 1) if nl != -1 else c.end()
    out = (out[:start]
           + f'{indent}<meta name="twitter:image" content="{url}">\n'
           + f'{indent}<meta name="twitter:image:alt" content="{alt}">'
           + ("" if m else "\n")
           + out[end:])
    return out, None


def main():
    check = "--check" in sys.argv
    written, stale, missing = [], [], []
    for rel, (slug, alt) in CARDS.items():
        card = ROOT / "assets" / "social" / f"{slug}.jpg"
        if not card.exists():
            missing.append(f"assets/social/{slug}.jpg")
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        out, err = rewrite(text, slug, alt)
        if err:
            print(f"SKIP   {rel}: {err}")
            continue
        if out == text:
            continue
        if check:
            stale.append(rel)
            continue
        path.write_text(out, encoding="utf-8")
        written.append(rel)

    if missing:
        for m in missing:
            print("MISSING CARD  " + m)
    if check:
        for rel in stale:
            print("STALE  " + rel)
        bad = stale or missing
        print(f"{len(stale)} stale, {len(missing)} missing card(s) of {len(CARDS)}"
              if bad else f"all {len(CARDS)} social cards current")
        return 1 if bad else 0
    print(f"wrote {len(written)} of {len(CARDS)} page(s)")
    for rel in written:
        print("  " + rel)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
