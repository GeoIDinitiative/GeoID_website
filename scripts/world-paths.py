#!/usr/bin/env python3
"""Give every world an ADDRESS: /geohub/<id>/ lands in that world's viewer.

    python3 scripts/world-paths.py
    python3 scripts/world-paths.py --check

THESE ARE NOT PAGES, and two earlier passes wrote them as pages before that
was settled. The way into a world is the PLANET ICON BAR along the foot of the
GIS page: `gis/planet-strip.js` already links each icon to
`/transit/?destination=<id>`, which loads the destination viewer in a
background iframe and crossfades to it once it has drawn. That wiring is built
and works, and nothing here changes it.

What it had no address for is the WORLD. Measured by driving it rather than
read: `/transit/?destination=mars` is a WAY-STATION -- it loads the viewer and
then lands the reader on `/?world=mars`, which is where a world actually lives.
That is a query on the root, fine as app state and not something to type, share
or hand a search engine. So `/geohub/mars/` exists to BE that address: a path
that reads as a path, forwarding to the world's own URL in ONE hop. Pointing it
at transit instead would put a hop in front of a hop for the same destination.
`/geohub/` itself is the same shape and for the same reason (old bookmarks,
shared links), which is why these sit under it.

NOINDEX, CANONICAL TO THE DESTINATION. A forwarding stub is not a document,
and offering one to a crawler as though it were is how a site comes to have ten
thin results saying nothing. The rel=canonical points at what the reader
actually arrives at, so a link to /geohub/mars/ credits the app rather than the
stub; they are deliberately NOT in sitemap.xml for the same reason.

The QUERY AND THE HASH TRAVEL, so /geohub/mars/?x=1#y arrives intact -- the one
thing a redirect must not quietly drop.
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

# Orrery order, the planet strip's own. Earth's GIS page IS the front page, so
# it is the bare root with no world named.
ORDER = ["mercury", "venus", "earth", "moon", "mars",
         "jupiter", "saturn", "uranus", "neptune", "pluto"]


def names():
    """Each world's display name, read out of the viewer's own registry.

    Written out here they would be right today and wrong the first time a body
    is renamed; bodies.js is what the strip, the shell and the viewers all
    already agree on.
    """
    src = (ROOT / "GeoID_GIS" / "viewer" / "gis" / "bodies.js").read_text(encoding="utf-8")
    found = dict(re.findall(r'id:\s*"([a-z]+)",\s*name:\s*"([^"]+)"', src))
    missing = [w for w in ORDER if w not in found]
    assert not missing, f"bodies.js names no {', '.join(missing)}"
    return found


def destination(wid):
    return "/" if wid == "earth" else f"/?world={wid}"


def stub(wid, name):
    target = destination(wid)
    # Earth's target carries no query of its own, so the reader's own query can
    # be appended; every other world's already names the world, and its
    # separator is an ampersand.
    join = "?" if wid == "earth" else "&"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(name)} &mdash; GeoID GeoHUB</title>
  <!--
    An ADDRESS, not a page. The way in is the planet icon bar on the GIS page;
    this path exists so the journey has a URL worth typing or sharing, and it
    forwards into the viewer. See scripts/world-paths.py.
  -->
  <link rel="canonical" href="https://geoidinitiative.com{target}">
  <meta name="robots" content="noindex, follow">
  <meta http-equiv="refresh" content="0; url={target}">
  <link rel="icon" type="image/png" href="/assets/GeoID_mark.png">
  <style>
    html {{ color-scheme: dark; }}
    body {{ margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 2rem; background: #040810; color: #c8dcec; font-family: "Public Sans", system-ui, -apple-system, sans-serif; text-align: center; line-height: 1.6; }}
    a {{ color: #58c6b3; }}
  </style>
</head>
<body>
  <main>
    <h1>Opening {html.escape(name)}&hellip;</h1>
    <p><a href="{target}">Continue to {html.escape(name)}</a></p>
  </main>
  <script>
    (function () {{
      var q = window.location.search;
      var to = {target!r} + (q ? {join!r} + q.slice(1) : "") + window.location.hash;
      window.location.replace(to);
    }})();
  </script>
</body>
</html>
"""


def main():
    check = "--check" in sys.argv
    name_of = names()
    written, stale = [], []
    for wid in ORDER:
        path = ROOT / "geohub" / wid / "index.html"
        wanted = stub(wid, name_of[wid])
        if path.exists() and path.read_text(encoding="utf-8") == wanted:
            continue
        if check:
            stale.append(f"geohub/{wid}/index.html")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(wanted, encoding="utf-8")
        written.append(f"geohub/{wid}/index.html")

    if check:
        for rel in stale:
            print("STALE  " + rel)
        print(f"{len(stale)} stale of {len(ORDER)}" if stale
              else f"all {len(ORDER)} world addresses current")
        return 1 if stale else 0
    print(f"wrote {len(written)} of {len(ORDER)} world address(es)")
    for w in written:
        print("  " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
