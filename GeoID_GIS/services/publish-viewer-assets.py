#!/usr/bin/env python3
"""
Move a viewer's own assets — its textures, DEMs and legends — into the bucket.

`publish-tiles.py` moves a baked pyramid and `publish-data.py` the loose files
under `data/global`. This moves what a self-contained viewer ships beside
itself: `planet_explorer/mars/viewer/assets/`, `GeoID_Earth/assets/` and the
rest. Together they are most of what is left in a repository that is over
GitHub Pages' 1 GB limit.

THESE VIEWERS HAVE NO RESOLVER SEAM. They are ten self-contained copies, they
are deliberately NOT swept by `stamp.py`, and each names its assets by relative
path in a manifest and a handful of modules. So the reference is rewritten in
place, and `--unpublish` rewrites it back — the transformation is mechanical and
reversible in both directions rather than a one-way edit.

WHAT IS AND IS NOT MOVED. Only files at or above `--min-bytes` (256 KB by
default): an icon or a logo is cheap to ship, and every file left alone is one
that cannot break. The fingerprint in `?v=` is the file's own content hash, so
the bucket's `immutable, max-age=1 year` is safe and a re-baked texture is a
different URL.

    python3 publish-viewer-assets.py planet_explorer/mars/viewer \\
        --key planet-mars --base https://data.example.com
    python3 publish-viewer-assets.py planet_explorer/mars/viewer \\
        --key planet-mars --base https://data.example.com --unpublish

Credentials are rclone's; this names a configured remote and reads no key.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE_CONTROL = "public, max-age=31536000, immutable"
# CSS TOO: a `url(./assets/x.jpg)` in a stylesheet names an asset exactly as a
# module does, and leaving it out untracked the file while the only remaining
# reference to it stayed local — a 404 in production and a 200 on the dev
# server, which is the shape that hides until deploy.
CODE = (".js", ".html", ".json", ".css")

# THE `hotlink-ok` SEGMENT IS LOAD-BEARING, not decoration. Cloudflare's Hotlink
# Protection 403s any IMAGE whose Referer is a domain other than the zone, which
# is right for the public site and fatal for a bucket that exists to be read
# from it — measured, the identical file answers 200 with no Referer, 200 from
# geoidinitiative.com and 403 from localhost, while a .wav beside it is
# untouched. Cloudflare exempts any path containing `hotlink-ok`, so publishing
# under it keeps the main site's protection intact and makes local development
# work. Verified both nested and at the root: 200 either way.
PREFIX = "assets/hotlink-ok"


def die(m: str) -> None:
    sys.exit(f"publish-viewer-assets: {m}")


def fingerprint(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def tracked_files() -> set[str]:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, cwd=ROOT)
    return {x for x in out.stdout.split("\0") if x}


def movable(assets: pathlib.Path, min_bytes: int) -> dict:
    """
    Relative name -> path, for what the SITE ships and is worth moving.

    TRACKED IS THE TEST, not merely present on disk. These assets/ folders also
    hold the raw material somebody baked them from — a 631 MB ArcGIS project
    package under venus, 120 MB of shapefiles and geodatabase tables under the
    moon — none of it tracked, none of it referenced, and all of it uploaded on
    the first run because it was simply sitting there. A publisher that walks
    the DIRECTORY publishes the developer's working files; one that walks the
    INDEX publishes the site.
    """
    tracked = tracked_files()
    out = {}
    for p in sorted(assets.rglob("*")):
        if (p.is_file() and p.stat().st_size >= min_bytes
                and str(p.relative_to(ROOT)) in tracked):
            out[str(p.relative_to(assets))] = p
    return out


def in_bucket(assets: pathlib.Path, remote: str, key: str) -> dict:
    """
    Whatever the prefix already holds, matched back to the local file.

    The last gap the other two leave: a file that has been untracked BECAUSE it
    was published, and whose only surviving reference is a form the earlier run
    did not rewrite — a `url()` in a stylesheet, say. Tracked says no, the
    source names no bucket URL for it, and it would be quietly dropped from
    every later run while still being served. The bucket itself is the record.
    """
    out = {}
    listed = subprocess.run(["rclone", "lsf", "-R", "--files-only",
                             f"{remote.rstrip('/')}/{PREFIX}/{key}"],
                            capture_output=True, text=True)
    for rel in (l for l in listed.stdout.split("\n") if l):
        p = assets / rel
        if p.is_file():
            out[rel] = p
    return out


def already_published(viewer: pathlib.Path, assets: pathlib.Path, key: str) -> dict:
    """
    What a RE-publish must still cover.

    Tracked alone is right the first time and wrong every time after: publishing
    untracks the files, so a second run would find nothing to publish and a
    cleanup keyed on `tracked` would purge the live objects — which it did, to
    all 66 of Mars's, because they were untracked precisely BECAUSE they were
    published. What the site ships is what its code NAMES, so the bucket URLs
    already in the source are the other half of the answer.
    """
    out = {}
    for f in viewer.rglob("*"):
        if f.suffix not in CODE or not f.is_file():
            continue
        for rel in re.findall(r"/" + re.escape(PREFIX) + "/" + re.escape(key)
                              + r"/([A-Za-z0-9_./-]+?)(?:\?v=[0-9a-f]+)?(?=[\"'`)\s])",
                              f.read_text(errors="surrogateescape")):
            p = assets / rel
            if p.is_file():
                out[rel] = p
    return out


def code_files(viewer: pathlib.Path):
    return [p for p in viewer.rglob("*") if p.suffix in CODE and p.is_file()]


def source_forms(assets: pathlib.Path) -> list[str]:
    """
    Every textual prefix a reference to THIS assets folder can wear.

    `assets/x.png`, `./assets/x.png`, `../assets/x.png` and the absolute
    `/GeoID_Earth/assets/x.png` are the same file; a rewrite that knows only the
    first two leaves the others pointing at a path that is about to stop
    existing. Deriving the absolute form from the folder's own location is what
    keeps this from also matching another viewer's identically-named file.

    `../assets/` is here because leaving it out did not skip the reference --
    it half-rewrote it. The bare `assets/` form matched the TAIL and the `../`
    stayed welded to the front, so a manifest ended up holding
    `../https://data.geoidinitiative.com/...`, which resolves against the page
    and 404s. That is what took the Earth DEM off the globe: no elevation map,
    so the vertical-exaggeration slider disabled itself and every layer built
    on relief went flat. Longest form first, and the lookbehind below refuses a
    preceding slash so no prefix can ever be half-eaten again.
    """
    return ["/" + str(assets.relative_to(ROOT)) + "/", "../assets/", "./assets/", "assets/"]


def rewrite(viewer: pathlib.Path, names: dict, base: str, key: str,
            roots: list[pathlib.Path], assets: pathlib.Path) -> int:
    """`<any known prefix>x.png?v=123` -> `<base>/<PREFIX>/<key>/x.png?v=<hash>`"""
    changed = 0
    seen = set()
    for f in [x for r in roots for x in code_files(r)]:
        if f in seen:
            continue
        seen.add(f)
        s = original = f.read_text(errors="surrogateescape")
        forms = source_forms(assets)
        for rel in sorted(names, key=len, reverse=True):
            url = f"{base.rstrip('/')}/{PREFIX}/{key}/{rel}?v={fingerprint(names[rel])}"
            for form in forms:
                s = re.sub(r"(?<![\w./-])" + re.escape(form) + re.escape(rel)
                           + r"(?:\?[^\"'`)\s]*)?", url, s)
        if s != original:
            f.write_text(s, errors="surrogateescape")
            changed += 1
    return changed


def restore(viewer: pathlib.Path, base: str, key: str) -> int:
    changed = 0
    pattern = re.compile(re.escape(base.rstrip("/") + f"/{PREFIX}/{key}/")
                         + r"([A-Za-z0-9_./-]+)\?v=[0-9a-f]+")
    for f in code_files(viewer):
        s = original = f.read_text(errors="surrogateescape")
        s = pattern.sub(lambda m: f"assets/{m.group(1)}", s)
        if s != original:
            f.write_text(s, errors="surrogateescape")
            changed += 1
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("viewer", help="directory holding an assets/ folder")
    ap.add_argument("--key", required=True, help="bucket prefix under assets/")
    ap.add_argument("--base", required=True)
    ap.add_argument("--remote", default="r2:geoid-maps")
    ap.add_argument("--min-bytes", type=int, default=256 * 1024)
    ap.add_argument("--rewrite-in", action="append", default=[],
                    help="extra directory whose code names these assets "
                         "(repeatable); the viewer's own tree is always included")
    ap.add_argument("--unpublish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    viewer = (ROOT / args.viewer).resolve()
    assets = viewer / "assets"
    if not assets.is_dir():
        die(f"no assets/ under {args.viewer}")

    if args.unpublish:
        roots = [viewer] + [(ROOT / r).resolve() for r in args.rewrite_in]
        n = sum(restore(r, args.base, args.key) for r in roots)
        print(f"{args.key}: references restored to assets/ in {n} files")
        return 0

    names = {**movable(assets, args.min_bytes),
             **in_bucket(assets, args.remote, args.key),
             **already_published(viewer, assets, args.key)}
    if not names:
        die("nothing at or above the size floor")
    total = sum(p.stat().st_size for p in names.values())

    if not shutil.which("rclone"):
        die("rclone is not installed")
    listing = ROOT / ".git" / "geoid-publish-files.txt"
    listing.write_text("\n".join(sorted(names)) + "\n")
    cmd = ["rclone", "copy", str(assets), f"{args.remote.rstrip('/')}/{PREFIX}/{args.key}",
           "--header-upload", f"Cache-Control: {CACHE_CONTROL}",
           # NAMED EXPLICITLY rather than filtered by size. `--min-size` would
           # sweep up every untracked working file that happens to be big
           # enough — and it has: a bare number is KiB to rclone, so an earlier
           # `--min-size 262144` meant 256 GiB, matched nothing, copied nothing
           # and exited 0, publishing into an empty prefix that every reference
           # had already been rewritten to. A file list cannot do either.
           "--files-from", str(listing),
           "--transfers", "8", "--checkers", "8", "--stats-one-line"]
    if args.dry_run:
        cmd.append("--dry-run")
    print(f"  rclone copy -> {args.remote}/{PREFIX}/{args.key}  "
          f"({len(names)} files, {total / 1048576:.1f} MB)")
    if subprocess.run(cmd).returncode != 0:
        die("rclone failed; nothing was rewritten")
    if args.dry_run:
        print("dry run — no references rewritten")
        return 0

    # A ZERO EXIT IS NOT EVIDENCE THE FILES ARRIVED. Count them in the bucket
    # before rewriting a single reference: rewriting first and checking never
    # is how a viewer ends up pointing at 404s that a local dev server hides,
    # because the files it no longer ships are still sitting on the disk.
    listed = subprocess.run(
        ["rclone", "lsf", "-R", "--files-only",
         f"{args.remote.rstrip('/')}/{PREFIX}/{args.key}"],
        capture_output=True, text=True)
    there = {line for line in listed.stdout.split("\n") if line}
    absent = [rel for rel in names if rel not in there]
    if absent:
        die(f"{len(absent)} of {len(names)} files are NOT in the bucket "
            f"(e.g. {absent[0]}) — nothing was rewritten")
    print(f"  verified {len(there)} objects in the bucket")

    roots = [viewer] + [(ROOT / r).resolve() for r in args.rewrite_in]
    n = rewrite(viewer, names, args.base, args.key, roots, assets)
    print(f"{args.key}: {len(names)} files ({total / 1048576:.1f} MB) now served "
          f"from {args.base.rstrip('/')}/{PREFIX}/{args.key}/, {n} files rewritten")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
