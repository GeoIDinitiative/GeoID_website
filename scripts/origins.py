#!/usr/bin/env python3
"""Every remote origin the app's own code names, read out of the source.

    python3 scripts/origins.py            # the list, with who names each one
    python3 scripts/origins.py --policy   # the connect-src / img-src fragments

WHY THIS IS DERIVED AND NOT TYPED. A Content-Security-Policy's `connect-src`
is a list of the places the app may fetch from, and this app fetches from
dozens: tile services, event feeds, elevation pyramids, seismic archives,
gazetteers, the sidecar on localhost. Typed out by hand that list is wrong the
first time a dataset is added, and the failure is SILENT in the worst way --
the fetch is refused, the layer draws nothing, and the page looks like a
service that is down.

DRIVING A BROWSER IS NOT ENOUGH EITHER, which is the reason this exists rather
than trusting scripts/csp-verify.py alone: most of these fetches only happen
when somebody ticks a layer, so a page load exercises a handful of them. The
source names all of them whether or not anybody pressed anything.

What is scanned is the code that RUNS in a page -- the viewers, the shared
gis/ modules, the site scripts. Not the bake scripts, which run on a laptop
and never in a browser, and not page_backups.
"""
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent

# The trees whose code is loaded by a page. `services/` is deliberately out:
# those are Workers and Cloud Functions, and what they fetch is their own
# business, not the browser's.
TREES = ["GeoID_GIS/viewer", "planet_explorer", "earth_explorer", "everest",
         "scripts", "transit", "flight_sim"]
SKIP = ("page_backups", "node_modules", "/vendor/", "/.git/")

URL = re.compile(r"https?://[A-Za-z0-9.\-]+(?::\d+)?", re.I)

# Named rather than inferred, because an origin's PURPOSE decides which
# directive it belongs in and no pattern can read that off a string.
PLACEHOLDER = {"example.com", "localhost", "127.0.0.1", "0.0.0.0"}


def sources():
    for tree in TREES:
        base = ROOT / tree
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix.lower() not in (".js", ".mjs", ".html"):
                continue
            rel = str(path.relative_to(ROOT))
            if any(s.strip("/") in rel for s in SKIP):
                continue
            yield rel, path.read_text(encoding="utf-8", errors="replace")


def scan():
    """origin -> the files that name it."""
    found = {}
    for rel, text in sources():
        for hit in URL.findall(text):
            parts = urlsplit(hit)
            host = parts.hostname or ""
            if not host or "." not in host and host not in PLACEHOLDER:
                continue
            origin = f"{parts.scheme.lower()}://{parts.netloc.lower()}"
            found.setdefault(origin, set()).add(rel)
    return found


def main():
    found = scan()
    if "--policy" in sys.argv:
        remote = sorted(o for o in found
                        if urlsplit(o).hostname not in PLACEHOLDER)
        print("connect-src 'self' data: blob: " + " ".join(remote))
        return 0
    for origin in sorted(found):
        who = sorted(found[origin])
        print(f"{origin:52s} {len(who):3d}  {who[0]}")
    print(f"\n{len(found)} origins named by the app's own code")
    return 0


if __name__ == "__main__":
    sys.exit(main())
