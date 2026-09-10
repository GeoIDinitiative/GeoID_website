#!/usr/bin/env python3
"""
Put the LOOSE data files in object storage, and record where they went.

`publish-tiles.py` moves a baked pyramid; this moves everything under
`data/global/` that is not one — the Natural Earth vectors, the stress
measurements, the volcano catalogue, the ice sheets, and the two ice sidecars
(`names.json`, `thickness.json`). About 43 MB, on a repository already past
GitHub Pages' 1 GB limit.

THE BUCKET ROOT MIRRORS `data/global/`, which is what makes one rule cover both
kinds: `data/global/glim/0/0/0.mvt` is `<base>/glim/0/0/0.mvt` and
`data/global/coastline_10m.geojson` is `<base>/coastline_10m.geojson`. Nothing
has to know which of the two it is holding.

AND `sources.json` STAYS WITH THE SITE. Same split as a pyramid's manifest, for
a second reason as well as the first: it carries a CONTENT FINGERPRINT per file,
which is what makes a long immutable cache safe. These files carry no version of
their own — a re-baked `volcanoes.geojson` at a bare URL under
`max-age=31536000, immutable` would be invisible for a year — so the fingerprint
is computed here and appended by the client. It is a few hundred bytes and it is
read before any fetch, so it cannot live in the bucket it describes.

    python3 GeoID_GIS/services/publish-data.py --base https://data.example.com
    python3 GeoID_GIS/services/publish-data.py --check
    python3 GeoID_GIS/services/publish-data.py --unpublish   # back to local

Credentials are rclone's, exactly as in `publish-tiles.py`: this names a
configured remote and reads no key of its own.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"
SOURCES = GLOBAL / "sources.json"

CACHE_CONTROL = "public, max-age=31536000, immutable"

# The two legend sidecars that live inside a pyramid's folder but are NOT tiles:
# `publish-tiles.py` already uploads them with the pyramid, so they need a
# fingerprint here and no second upload.
# Files that live in a SUBDIRECTORY of data/global rather than at its top.
#
# Two kinds: sidecars that ride with a pyramid (the ice names and thicknesses),
# and datasets that are a single large file rather than a tree — the soil
# thickness COG is 99 MB of Cloud-Optimised GeoTIFF that the page range-reads,
# so it has no tiles to bake and no manifest of its own. Both need a
# fingerprint in `sources.json` for the same reason as a loose file: the bucket
# serves them immutable for a year, and a re-bake at a bare URL would be
# invisible for all of it.
NESTED_FILES = (
    "ice/names.json",
    "ice/thickness.json",
    "soil-thickness/soil_thickness_1km.hotlink-ok.tif",
    "worldpop/ppp_2020_1km.hotlink-ok.tif",
)

# STORED GZIPPED, and this is what made the hazard risk maps load at all.
#
# Cloudflare does not edge-cache `.geojson` or `.json` -- neither is on its
# default list of cacheable extensions -- so every request for one goes back to
# R2 (`cf-cache-status: DYNAMIC`) and is compressed ON THE FLY. That is fine for
# a few megabytes and a crawl for twenty: measured on the live bucket, the 23 MB
# cyclone risk grid came down at 3.8 KB/s under gzip and 93 KB/s uncompressed,
# about four minutes, while the page said "Loading..." the whole time and
# nothing errored. The 4.7 MB volcanic grid loaded in seconds, which is why the
# fault looked like "some risk maps are broken" rather than "big files are slow".
#
# Stored already gzipped with `Content-Encoding: gzip`, the same grid is 1.8 MB
# and Cloudflare passes it straight through: 0.6 s, and a browser's `fetch()`
# decodes it transparently -- 91,156 features parsed in 510 ms. JSON compresses
# about thirteenfold, so this is the whole difference.
#
# The FINGERPRINT stays on the uncompressed file, which is what the page parses;
# an encoding change is not a content change, so re-publishing this way needs no
# change to `sources.json` and no push of the site. Deterministic gzip (no name,
# no mtime) so an unchanged file re-uploads as the same bytes and rclone skips it.
#
# NEVER a `.tif`: the COGs are range-read, and a byte range of a gzip stream is
# not a byte range of the file.
GZIP_AT_REST = (".geojson", ".json")

# Never published: the manifests and this file are the metadata that has to be
# readable BEFORE — and without — the bucket, and README is for a reader of the
# repository rather than the app.
KEEP_LOCAL = ("README.md", "sources.json")


def die(message: str) -> None:
    sys.exit(f"publish-data: {message}")


def fingerprint(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def gzipped(path: pathlib.Path) -> bytes:
    """Deterministic: no file name and a zero mtime, so the same input gives the
    same bytes and an unchanged file is not uploaded again."""
    return gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)


def loose_files() -> list[pathlib.Path]:
    """Everything at the top of data/global that is a file, minus the metadata."""
    return sorted(p for p in GLOBAL.iterdir()
                  if p.is_file() and p.name not in KEEP_LOCAL)


def upload(paths: list[pathlib.Path], remote: str, dry: bool) -> int:
    if not shutil.which("rclone"):
        die("rclone is not installed; it is what talks to the bucket")
    # Every file to publish, by its path relative to data/global. The nested
    # ones by their relative path: `ice/names.json` rides with the pyramid
    # `publish-tiles` uploads; a single-file dataset like the soil thickness
    # COG has no pyramid to ride with, so it is named here.
    rels = [p.name for p in paths]
    rels += [rel for rel in NESTED_FILES if (GLOBAL / rel).is_file()]
    packed = [rel for rel in rels if rel.endswith(GZIP_AT_REST)]
    plain = [rel for rel in rels if not rel.endswith(GZIP_AT_REST)]

    def copy(source: pathlib.Path, names: list[str], headers: list[str]) -> int:
        if not names:
            return 0
        args = ["rclone", "copy", str(source), remote,
                "--header-upload", f"Cache-Control: {CACHE_CONTROL}",
                "--transfers", "8", "--checkers", "8", "--stats-one-line"]
        for h in headers:
            args += ["--header-upload", h]
        # Only the named files: a bare `copy` of data/global would re-upload
        # every pyramid, which is gigabytes of work to say nothing new.
        for name in names:
            args += ["--include", name]
        if dry:
            args.append("--dry-run")
        return subprocess.run(args).returncode

    print(f"  rclone copy -> {remote}  ({len(packed)} gzipped at rest, {len(plain)} as they are)")
    with tempfile.TemporaryDirectory(prefix="publish-data-") as stage:
        stage_dir = pathlib.Path(stage)
        for rel in packed:
            out = stage_dir / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(gzipped(GLOBAL / rel))
        code = copy(stage_dir, packed, ["Content-Encoding: gzip"])
    return code or copy(GLOBAL, plain, [])


def write_sources(base: str | None) -> dict:
    body: dict = {"base": base.rstrip("/")} if base else {}
    if base:
        files = {}
        for p in loose_files():
            files[p.name] = fingerprint(p)
        for rel in NESTED_FILES:
            p = GLOBAL / rel
            if p.is_file():
                files[rel] = fingerprint(p)
        body["files"] = files
    SOURCES.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n")
    return body


def check(body: dict) -> int:
    base = body.get("base")
    files = body.get("files") or {}
    if not base or not files:
        die("sources.json names no base — nothing to check")
    rel, stamp = sorted(files.items())[0]
    url = f"{base}/{rel}?v={stamp}"
    print(f"  GET {url}")
    request = urllib.request.Request(url, method="GET", headers={
        "Origin": "https://geoidinitiative.com",
        # Cloudflare's bot rules 403 the default Python-urllib agent; the point
        # of this command is to ask what a BROWSER would ask.
        "User-Agent": "Mozilla/5.0 (compatible; GeoID publish-data check)",
    })
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            size = len(response.read())
            allow = response.headers.get("access-control-allow-origin")
            cache = response.headers.get("cache-control")
    except urllib.error.HTTPError as error:
        die(f"the bucket answered HTTP {error.code} — is it publicly readable?")
    except urllib.error.URLError as error:
        die(f"could not reach {base} ({error.reason}) — is the domain bound?")
    ok = True
    print(f"  {size:,} bytes")
    if allow:
        print(f"  access-control-allow-origin: {allow}")
    else:
        print("  NO access-control-allow-origin — a browser will refuse this.")
        ok = False
    print(f"  cache-control: {cache or 'NOT SET'}")

    # And every JSON file must be served COMPRESSED: an uncompressed one is not
    # an error anywhere, it is just a map that takes minutes to arrive.
    slow = []
    for rel, stamp in sorted(files.items()):
        if not rel.endswith(GZIP_AT_REST):
            continue
        head = urllib.request.Request(f"{base}/{rel}?v={stamp}", method="HEAD", headers={
            "Origin": "https://geoidinitiative.com", "Accept-Encoding": "gzip",
            "User-Agent": "Mozilla/5.0 (compatible; GeoID publish-data check)"})
        try:
            with urllib.request.urlopen(head, timeout=30) as response:
                # `content-encoding: gzip` alone proves nothing: Cloudflare's
                # ON-THE-FLY compression answers with it too, and that is the
                # slow path. Stored gzip is served as the object itself, so it
                # carries a length and a strong ETag; on-the-fly is chunked with
                # a WEAK one (`W/"..."`). Measured on the probe and the live grid.
                h = response.headers
                stored = (h.get("content-encoding") == "gzip" and h.get("content-length")
                          and not (h.get("etag") or "").startswith("W/"))
                if not stored:
                    slow.append(rel)
        except urllib.error.URLError:
            slow.append(rel)
    packed = [r for r in files if r.endswith(GZIP_AT_REST)]
    if slow:
        print(f"  {len(slow)} of {len(packed)} JSON files served UNCOMPRESSED "
              "(re-run publish to store them gzipped):")
        for rel in slow:
            print(f"    {rel}")
        ok = False
    else:
        print(f"  all {len(packed)} JSON files stored gzipped")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remote", default="r2:geoid-maps")
    parser.add_argument("--base", help="public URL the files will be served from")
    parser.add_argument("--unpublish", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.check:
        if not SOURCES.is_file():
            die("no sources.json — nothing has been published")
        return check(json.loads(SOURCES.read_text()))

    if args.unpublish:
        write_sources(None)
        print("data: sources.json cleared — the files are read from the site again")
        return 0

    if not args.base:
        die("--base is required: the public URL the files will be served from")

    paths = loose_files()
    if not paths:
        die("no loose files found under data/global")
    code = upload(paths, args.remote.rstrip("/"), args.dry_run)
    if code != 0:
        die(f"rclone exited {code}; sources.json was NOT changed")
    if args.dry_run:
        print("dry run — sources.json was not changed")
        return 0
    body = write_sources(args.base)
    total = sum((GLOBAL / f).stat().st_size for f in body["files"]
                if (GLOBAL / f).is_file())
    print(f"data: {len(body['files'])} files ({total / 1048576:.1f} MB) "
          f"now served from {body['base']}")
    print("  next: python3 GeoID_GIS/services/publish-data.py --check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
