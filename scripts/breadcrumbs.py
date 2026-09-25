#!/usr/bin/env python3
"""Put a BreadcrumbList on every indexable page that is not the home page.

    python3 scripts/breadcrumbs.py
    python3 scripts/breadcrumbs.py --check

WHAT A BREADCRUMB IS FOR, since it is easy to mistake it for decoration. In a
search result Google draws the URL as a trail -- `geoidinitiative.com › GeoHUB
› Worlds › Mars` -- instead of the raw address, and it takes that trail from
BreadcrumbList structured data. Without it, every one of these pages is
offered as a bare URL with no sense of where it sits, and a reader choosing
between results cannot tell a world page from a legal notice.

THE TRAIL HAS TO BE TRUE, and that is the whole of the maintenance burden
here: every rung must be a real, indexable URL, and the LAST rung is the page
itself. Google ignores a trail whose items do not resolve, and a trail that
disagrees with the page's own navigation is worse than none.

The world addresses under /geohub/ are NOT here and take no breadcrumb:
`scripts/world-paths.py` writes them as forwarding stubs into each world's
viewer, and a stub is not a document to sit on a trail.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HOME = ("Home", "/")
GEOHUB = ("GeoHUB", "/about_geohub/")
ABOUT = ("About", "/about/")
LEGAL_NOTE = "These four are reached from every page's footer, so their parent is the site."

# Each page's trail, HOME implied first. Chosen to match how the site's own
# navigation reaches the page, not to invent a hierarchy for Google.
TRAILS = {
    "about/index.html":            [ABOUT],
    "about_geohub/index.html":     [GEOHUB],
    "dashboard/index.html":        [("Dashboard", "/dashboard/")],
    "earth_explorer/index.html":   [("Earth Explorer", "/earth_explorer/")],
    "earth_explorer/etna/index.html": [("Earth Explorer", "/earth_explorer/"),
                                       ("Mount Etna", "/earth_explorer/etna/")],
    "everest/index.html":          [("Earth Explorer", "/earth_explorer/"),
                                    ("Mount Everest — ASCENT", "/everest/")],
    "membership/index.html":       [("Membership", "/membership/")],
    "team/index.html":             [ABOUT, ("Our Team", "/team/")],
    "get-involved/index.html":     [ABOUT, ("Get Involved", "/get-involved/")],
    "updates/index.html":          [ABOUT, ("Journal", "/updates/")],
    "researchers/index.html":      [("For Researchers", "/researchers/")],
    "data/index.html":             [("Data Sources", "/data/")],
    "contact/index.html":          [("Contact", "/contact/")],
    "fund.html":                   [ABOUT, ("Roadmap & Partnerships", "/fund.html")],
    "privacy/index.html":          [("Privacy Policy", "/privacy/")],
    "terms/index.html":            [("Terms of Service", "/terms/")],
    "disclaimer/index.html":       [("Disclaimer", "/disclaimer/")],
    "refund/index.html":           [("Billing & Refunds", "/refund/")],
}

BLOCK = re.compile(
    r'^[ \t]*<script type="application/ld\+json" data-breadcrumb>.*?</script>\n',
    re.S | re.M)


def block_for(trail):
    items = [{"@type": "ListItem", "position": i + 1, "name": name,
              "item": f"https://geoidinitiative.com{url}"}
             for i, (name, url) in enumerate([HOME, *trail])]
    body = json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList",
                       "itemListElement": items}, indent=2, ensure_ascii=False)
    body = "\n".join("  " + line for line in body.split("\n"))
    return f'  <script type="application/ld+json" data-breadcrumb>\n{body}\n  </script>\n'


def main():
    check = "--check" in sys.argv
    stale, written, missing = [], [], []
    for rel, trail in TRAILS.items():
        path = ROOT / rel
        if not path.exists():
            missing.append(rel)
            continue
        text = path.read_text(encoding="utf-8")
        wanted = block_for(trail)
        found = BLOCK.search(text)
        if found and found.group(0) == wanted:
            continue
        if check:
            stale.append(rel)
            continue
        if found:
            text = text[:found.start()] + wanted + text[found.end():]
        else:
            # After the canonical, which is the other statement about where
            # this page is; if a page has none, after its title.
            anchor = re.search(r'^[ \t]*<link rel="canonical"[^>]*>\n', text, re.M) \
                or re.search(r"^[ \t]*<title>.*?</title>\n", text, re.M | re.S)
            if not anchor:
                missing.append(f"{rel} (no canonical or title to anchor on)")
                continue
            text = text[:anchor.end()] + wanted + text[anchor.end():]
        path.write_text(text, encoding="utf-8")
        written.append(rel)

    for rel in missing:
        print("SKIP  " + rel)
    if check:
        for rel in stale:
            print("STALE  " + rel)
        print(f"{len(stale)} stale of {len(TRAILS)}" if stale
              else f"all {len(TRAILS)} breadcrumbs current")
        return 1 if stale or missing else 0
    print(f"wrote {len(written)} of {len(TRAILS)} breadcrumbs")
    for rel in written:
        print("  " + rel)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
