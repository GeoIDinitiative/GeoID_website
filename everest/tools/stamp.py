#!/usr/bin/env python3
"""
Cache-bust every local module import under everest/.

    python3 everest/tools/stamp.py            # stamp
    python3 everest/tools/stamp.py --check    # non-zero if the tree is not uniform

WHY
    This is a static site with no build step, and ES module identity is by
    URL. A returning browser happily serves its cached `imagery.js` against a
    freshly edited `terrain.js`, so a fix that landed on disk is simply not
    the code that runs — and the symptom is that a bug you have already fixed
    is still there, reported by someone whose browser never fetched the fix.
    That has now happened once, on the tile-seam striping, and cost a round
    trip to work out.

    `GeoID_GIS/services/stamp.py` solves the same problem for the viewer; this
    is the same idea scoped to this folder, and deliberately separate because
    that script's 8-digit regex would mangle these files.

WHAT IT TOUCHES
    - `import ... from "./x.js"` and `"../vendor/three.module.js"` in game/*.js
    - `<script type="module" src="...">` and dynamic `import("...")` in the HTML
    - `<link rel="stylesheet" href="everest.css">`

    Every one gets `?v=<stamp>`, where the stamp is the short git sha plus a
    digest of the tree's own contents. The digest matters: the sha alone does
    not change on an uncommitted edit, so a stamp built from it re-stamps to
    the SAME value and the browser keeps serving what it already had — which
    is precisely the failure this is meant to prevent.
"""

import argparse
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "game"

# Local references only. Anything absolute or cross-origin is left alone —
# three.module.js in vendor/ is local and IS stamped, because a stale copy of
# it breaks class identity against a freshly stamped module that imported it.
PATTERNS = [
    re.compile(r'(from\s+["\'])(\.{1,2}/[^"\'?]+\.js)(\?v=[^"\']*)?(["\'])'),
    re.compile(r'(import\s*\(\s*["\'])(\.{1,2}/[^"\'?]+\.js)(\?v=[^"\']*)?(["\']\s*\))'),
    re.compile(r'(<script[^>]*\ssrc=["\'])(\.{0,2}/?game/[^"\'?]+\.js)(\?v=[^"\']*)?(["\'])'),
    re.compile(r'(<link[^>]*\shref=["\'])(everest\.css)(\?v=[^"\']*)?(["\'])'),
]


def tree_digest() -> str:
    h = hashlib.sha256()
    for f in sorted(list(GAME.glob("*.js")) + [ROOT / "index.html", ROOT / "everest.css"]):
        if f.exists():
            h.update(f.name.encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:8]


def git_sha() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"],
                             cwd=ROOT, capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or "nogit"
    except Exception:
        return "nogit"


def files():
    yield ROOT / "index.html"
    if (ROOT / "dev.html").exists():
        yield ROOT / "dev.html"
    yield from sorted(GAME.glob("*.js"))


def run(check: bool) -> int:
    # Digest first: it must be computed from the UNSTAMPED content, or the
    # stamp feeds back into itself and never settles.
    stripped = {}
    for f in files():
        s = f.read_text()
        for p in PATTERNS:
            s = p.sub(lambda m: m.group(1) + m.group(2) + m.group(4), s)
        stripped[f] = s

    h = hashlib.sha256()
    for f in sorted(stripped, key=lambda p: p.name):
        h.update(f.name.encode())
        h.update(stripped[f].encode())
    stamp = f"{git_sha()}-{h.hexdigest()[:8]}"

    changed = []
    for f, base in stripped.items():
        out = base
        for p in PATTERNS:
            out = p.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={stamp}{m.group(4)}", out)
        if out != f.read_text():
            changed.append(f.relative_to(ROOT))
            if not check:
                f.write_text(out)

    if check:
        if changed:
            print(f"stale stamps in: {', '.join(str(c) for c in changed)}")
            return 1
        print(f"ok — every import stamped {stamp}")
        return 0

    print(f"stamped {stamp} across {len(list(files()))} files"
          + (f" ({len(changed)} updated)" if changed else " (already current)"))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    sys.exit(run(ap.parse_args().check))
