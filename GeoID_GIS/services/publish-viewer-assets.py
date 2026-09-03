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
CODE = (".js", ".html", ".json")


def die(m: str) -> None:
    sys.exit(f"publish-viewer-assets: {m}")


def fingerprint(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def movable(assets: pathlib.Path, min_bytes: int) -> dict:
    """Relative name -> path, for everything big enough to be worth moving."""
    out = {}
    for p in sorted(assets.rglob("*")):
        if p.is_file() and p.stat().st_size >= min_bytes:
            out[str(p.relative_to(assets))] = p
    return out


def code_files(viewer: pathlib.Path):
    return [p for p in viewer.rglob("*") if p.suffix in CODE and p.is_file()]


def rewrite(viewer: pathlib.Path, names: dict, base: str, key: str) -> int:
    """
    `assets/x.png?v=123` -> `<base>/assets/<key>/x.png?v=<hash>`

    Both the bare and the `./` form, because a lookbehind that rejects `.`
    silently misses `./assets/…` — which then goes on returning 200 from the
    dev server off a file that is no longer tracked, and ships broken.
    """
    changed = 0
    for f in code_files(viewer):
        s = original = f.read_text(errors="surrogateescape")
        for rel in sorted(names, key=len, reverse=True):
            url = f"{base.rstrip('/')}/assets/{key}/{rel}?v={fingerprint(names[rel])}"
            s = re.sub(r"(?:\./)?(?<![\w.-])assets/" + re.escape(rel) + r"(?:\?[^\"'`)\s]*)?",
                       url, s)
        if s != original:
            f.write_text(s, errors="surrogateescape")
            changed += 1
    return changed


def restore(viewer: pathlib.Path, base: str, key: str) -> int:
    changed = 0
    pattern = re.compile(re.escape(base.rstrip("/") + f"/assets/{key}/")
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
    ap.add_argument("--unpublish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    viewer = (ROOT / args.viewer).resolve()
    assets = viewer / "assets"
    if not assets.is_dir():
        die(f"no assets/ under {args.viewer}")

    if args.unpublish:
        n = restore(viewer, args.base, args.key)
        print(f"{args.key}: references restored to assets/ in {n} files")
        return 0

    names = movable(assets, args.min_bytes)
    if not names:
        die("nothing at or above the size floor")
    total = sum(p.stat().st_size for p in names.values())

    if not shutil.which("rclone"):
        die("rclone is not installed")
    cmd = ["rclone", "copy", str(assets), f"{args.remote.rstrip('/')}/assets/{args.key}",
           "--header-upload", f"Cache-Control: {CACHE_CONTROL}",
           # THE "B" SUFFIX IS LOAD-BEARING: rclone reads a bare number as KiB,
           # so `--min-size 262144` means 256 GiB, matches nothing, copies
           # nothing — and exits 0. That is how a publish "succeeded" into an
           # empty bucket prefix while every reference was rewritten to it.
           "--min-size", f"{args.min_bytes}B",
           "--transfers", "8", "--checkers", "8", "--stats-one-line"]
    if args.dry_run:
        cmd.append("--dry-run")
    print(f"  rclone copy -> {args.remote}/assets/{args.key}  "
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
         f"{args.remote.rstrip('/')}/assets/{args.key}"],
        capture_output=True, text=True)
    there = {line for line in listed.stdout.split("\n") if line}
    absent = [rel for rel in names if rel not in there]
    if absent:
        die(f"{len(absent)} of {len(names)} files are NOT in the bucket "
            f"(e.g. {absent[0]}) — nothing was rewritten")
    print(f"  verified {len(there)} objects in the bucket")

    n = rewrite(viewer, names, args.base, args.key)
    print(f"{args.key}: {len(names)} files ({total / 1048576:.1f} MB) now served "
          f"from {args.base.rstrip('/')}/assets/{args.key}/, {n} files rewritten")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
