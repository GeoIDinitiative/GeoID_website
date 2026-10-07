#!/usr/bin/env python3
"""Keep `noindex` on the pages that are not documents.

    python3 scripts/noindex.py            # add the tag where it is missing
    python3 scripts/noindex.py --check    # exit 1 if any page here lacks it

WHY. Search Console reported pages excluded by `noindex` and by canonicals on
2026-10-07, and both were intentional. The audit that followed found the real
problem: **24 pages were indexable, had no canonical, and were not in the
sitemap** -- the nine planet viewers (title: "Mars", "Venus"...), three dev
harnesses, an internal map-checking tool, two app shells titled "Earth", and a
documentation page with one word of body text. Left alone those are exactly
the thin, duplicate, brand-diluting results the sitemap was written to avoid.

NOT robots.txt. `Disallow` stops Google READING the page, so it never sees a
`noindex` and the bare URL can sit in results indefinitely -- robots.txt says
this at length and it is right. A crawlable page carrying `noindex` is the only
instruction that actually removes anything.

`follow` IS DELIBERATE. These frames link to real pages; a crawler should still
walk those links even though it must not list the frame itself.

WHAT IS NOT HERE. `/earth_explorer/etna/` and `/everest/` are real pages and
stay indexable -- only their `/viewer/` children are listed. node_modules under
gee-tiles is untracked and 404s on the live site, so it needs nothing.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAG = '<meta name="robots" content="noindex, follow">'

PAGES = [
    # dev harnesses — never meant for a reader
    "everest/dev.html",
    "flight_sim/mars/viewer/dev.html",
    "flight_sim/mars/viewer/index.html",
    "planet_explorer/mars/viewer/dev.html",
    # internal tooling
    "tools/moon_map_checker.html",
    # fragments and app shells, not documents
    "GeoID_GIS/viewer/gis/shell.html",
    "GeoID_GIS/index.html",
    "GeoID_GIS/viewer/index.html",
    "GeoID_GIS/docs/gee-setup.html",
    "GeoID_Earth/viewer/index.html",
    "flight_sim/mars_flightsim/index.html",
    "flight_sim/mars_flightsim/mars_flight_sim.html",
    "earth_explorer/etna/viewer/index.html",
] + [f"planet_explorer/{w}/viewer/index.html" for w in
     ("mercury", "venus", "moon", "mars", "jupiter",
      "saturn", "uranus", "neptune", "pluto")]

ROBOTS_RE = re.compile(r'<meta\s+name="robots"[^>]*>', re.I)
# After </title>, else <meta charset>, else <head>. The trailing newline is
# OPTIONAL on purpose: gee-setup.html ships a minified one-line head, and an
# anchor that demanded a newline silently matched nothing there — which the
# first version of this script then reported as "fine" because it could not
# tell "already tagged" from "could not tag".
ANCHORS = (re.compile(r'(</title>)', re.I),
           re.compile(r'(<meta\s+charset=[^>]*>)', re.I),
           re.compile(r'(<head[^>]*>)', re.I))


def apply(text):
    """Return (new_text, status) where status is 'ok', 'inserted' or 'no-anchor'."""
    m = ROBOTS_RE.search(text)
    if m:
        if "noindex" in m.group(0).lower():
            return text, "ok"
        return text[:m.start()] + TAG + text[m.end():], "inserted"
    for rx in ANCHORS:
        a = rx.search(text)
        if a:
            line_start = text.rfind("\n", 0, a.start()) + 1
            indent = re.match(r'[ \t]*', text[line_start:]).group(0)
            nl_after = text[a.end():a.end() + 1] == "\n"
            ins = (f"\n{indent}{TAG}" if nl_after else TAG)
            return text[:a.end()] + ins + text[a.end():], "inserted"
    return text, "no-anchor"


def main():
    check = "--check" in sys.argv
    done, stale, absent, stuck = [], [], [], []
    for rel in PAGES:
        p = ROOT / rel
        if not p.exists():
            absent.append(rel)
            continue
        text = p.read_text(encoding="utf-8")
        out, status = apply(text)
        if status == "ok":
            continue
        if status == "no-anchor":
            # never silently pass: this page has no noindex and the script
            # could not place one, which is the failure the --check exists for
            stuck.append(rel)
            continue
        if check:
            stale.append(rel)
            continue
        p.write_text(out, encoding="utf-8")
        done.append(rel)

    for rel in absent:
        print("MISSING FILE  " + rel)
    for rel in stuck:
        print("CANNOT TAG  " + rel + "  (no </title>, <meta charset> or <head> to anchor to)")
    if check:
        for rel in stale:
            print("NO NOINDEX  " + rel)
        bad = stale or absent or stuck
        print(f"{len(stale)} missing noindex, {len(stuck)} untaggable, {len(absent)} missing file(s)"
              if bad else f"all {len(PAGES)} non-document pages carry noindex")
        return 1 if bad else 0
    print(f"tagged {len(done)} of {len(PAGES)} page(s)")
    for rel in done:
        print("  " + rel)
    return 1 if (absent or stuck) else 0


if __name__ == "__main__":
    sys.exit(main())
