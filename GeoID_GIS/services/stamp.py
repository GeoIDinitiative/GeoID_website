#!/usr/bin/env python3
"""Stamp every cache-busting `?v=` in the viewer with one value.

Why this exists: the stamps were maintained by hand, and a hand-run
find-and-replace missed `gis/shell.js` because it was launched from inside
`gis/research/`. Half the tree ended up on one stamp and half on another --
and because ES module identity is by URL, `project-store.js?v=a` and
`project-store.js?v=b` are two different modules with two different `active`
projects. The GIS page and the Research Hub silently stopped sharing a store.

So: one command, no arguments, no judgement.

    python3 GeoID_GIS/services/stamp.py

Run it after editing anything under GeoID_GIS/viewer/ and before testing.
`--check` exits non-zero if the tree is not uniform, which is the useful thing
to put in a pre-commit hook.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Every file that can carry a stamp. The viewer's own modules, the planet pages
# that load them, and the shell page that frames the whole thing in an iframe.
GLOBS = (
    "GeoID_GIS/viewer/**/*.js",
    "GeoID_GIS/viewer/**/*.css",
    "GeoID_GIS/viewer/**/*.html",
    "planet_explorer/*/viewer/index.html",
    "myGeoID/index.html",
)

# Matches every stamp shape this repo has used: the old hand-written
# `?v=20260810y`, the shell's `?v=gis-...` variant, and the `?v=<date>-<sha>`
# this script writes. It has to match its OWN output or a second run appends to
# the first and the stamps grow without bound.
STAMP = re.compile(r"\?v=(gis-)?\d{8}[a-z]?(?:-[0-9a-z]{4,12})?")


def current_stamp() -> str:
    """Today plus the short commit, so a stamp says when and what."""
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sha = "nogit"
    date = subprocess.run(
        ["date", "+%Y%m%d"], capture_output=True, text=True, check=True,
    ).stdout.strip()
    return f"{date}-{sha}"


def files() -> list[Path]:
    found: list[Path] = []
    for pattern in GLOBS:
        found.extend(ROOT.glob(pattern))
    # Never rewrite the vendored three.js: earth-viewer.js imports it
    # unversioned, and a second URL for it breaks class identity outright.
    return sorted(p for p in found if "vendor" not in p.parts)


def stamps_in_tree() -> dict[str, int]:
    seen: dict[str, int] = {}
    for path in files():
        for match in STAMP.finditer(path.read_text(encoding="utf-8")):
            seen[match.group(0)] = seen.get(match.group(0), 0) + 1
    return seen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="report without writing; non-zero if not uniform")
    args = parser.parse_args()

    if args.check:
        seen = stamps_in_tree()
        bare = {s.replace("gis-", "") for s in seen}
        for stamp, count in sorted(seen.items()):
            print(f"  {count:4}  {stamp}")
        if len(bare) > 1:
            print(f"\nSPLIT: {len(bare)} different stamps. "
                  "Modules are duplicated by URL; run this script without "
                  "--check.", file=sys.stderr)
            return 1
        print("\nuniform")
        return 0

    stamp = current_stamp()
    touched = 0
    for path in files():
        text = path.read_text(encoding="utf-8")
        new = STAMP.sub(lambda m: f"?v={m.group(1) or ''}{stamp}", text)
        if new != text:
            path.write_text(new, encoding="utf-8")
            touched += 1
    print(f"stamped {touched} file(s) with ?v={stamp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
