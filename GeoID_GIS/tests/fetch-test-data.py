#!/usr/bin/env python3
"""
Fetch the published data the unit tests read, into data/global, and verify it.

The datasets are gitignored: they are baked locally and published to the
bucket at data.geoidinitiative.com. A fresh checkout -- CI -- has none of
them, so the tests that check the data itself (bounds, tiles, outlines, the
Earth Engine catalogue) failed there on every push while passing on a machine
that had baked them. This puts back exactly the files those tests read, from
what is actually published, and checks every one:

  * a file `sources.json` lists is fetched at its fingerprint and must hash
    to it (sha256, first 12 hex) once decompressed -- the bucket stores JSON
    gzipped at rest;
  * a pyramid tile is fetched at its manifest's `tiles_base` and `version`
    and must be the byte size the manifest records for it.

A file already on disk that passes is left alone, so a cached or baked tree
costs nothing. Anything that cannot be fetched or does not verify is a
failure, never a skip.

    python3 GeoID_GIS/tests/fetch-test-data.py            # fetch what is missing
    python3 GeoID_GIS/tests/fetch-test-data.py --record   # rebuild the list

--record reruns the data-reading tests under tests/fslog.mjs on a machine
that HAS the data, and rewrites tests/test-data.txt with what they touched.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import gzip
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"
LIST = pathlib.Path(__file__).with_name("test-data.txt")
HOOK = pathlib.Path(__file__).with_name("fslog.mjs")

# The tests that read data/global. --record runs these; a new test that reads
# the data belongs here too.
DATA_TESTS = [
    "GeoID_GIS/viewer/gis/global-data-bounds.test.mjs",
    "GeoID_GIS/viewer/gis/ice-cover.test.mjs",
    "GeoID_GIS/viewer/gis/mvt.test.mjs",
    "GeoID_GIS/viewer/gis/nomenclature-outlines.test.mjs",
    "GeoID_GIS/viewer/gis/gee-catalogue-index.test.mjs",
    "GeoID_GIS/viewer/gis/gee-watch.test.mjs",
]

# Cloudflare's bot rules refuse the default Python agent, and Hotlink
# Protection refuses an image without the site's Referer.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; GeoID CI)",
    "Origin": "https://geoidinitiative.com",
    "Referer": "https://geoidinitiative.com/",
    "Accept-Encoding": "gzip",
}
TILE = re.compile(r"^([a-z0-9-]+)/(\d+/\d+/\d+)\.mvt$")


def sha12(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def get(url: str, tries: int = 4) -> bytes:
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
                if r.headers.get("Content-Encoding", "").lower() == "gzip" or body[:2] == b"\x1f\x8b":
                    body = gzip.decompress(body)
                return body
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code in (403, 404):
                break
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def plan(rel: str, sources: dict, manifests: dict) -> tuple[str, str, object]:
    """(url, check kind, expected) for one path under data/global."""
    files = sources.get("files") or {}
    if rel in files:
        return f"{sources['base'].rstrip('/')}/{rel}?v={files[rel]}", "sha12", files[rel]
    m = TILE.match(rel)
    if m and m.group(1) in manifests:
        man = manifests[m.group(1)]
        size = (man.get("tiles") or {}).get(m.group(2))
        if size is None:
            raise RuntimeError(f"{rel}: not a tile its manifest lists")
        url = f"{man['tiles_base'].rstrip('/')}/{m.group(2)}.mvt"
        if man.get("version"):
            url += f"?v={man['version']}"
        return url, "size", int(size)
    raise RuntimeError(f"{rel}: neither sources.json nor a pyramid manifest says where it is published")


def passes(data: bytes, kind: str, expected) -> bool:
    return sha12(data) == expected if kind == "sha12" else len(data) == expected


def fetch_one(rel: str, sources: dict, manifests: dict) -> str:
    dest = GLOBAL / rel
    url, kind, expected = plan(rel, sources, manifests)
    if dest.is_file() and passes(dest.read_bytes(), kind, expected):
        return "kept"
    data = get(url)
    if not passes(data, kind, expected):
        got = sha12(data) if kind == "sha12" else len(data)
        raise RuntimeError(f"{rel}: published copy does not verify ({kind} {got} != {expected})")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return "fetched"


def load_manifests() -> dict:
    out = {}
    for man in GLOBAL.glob("*/manifest.json"):
        body = json.loads(man.read_text())
        if body.get("tiles_base"):
            out[man.parent.name] = body
    return out


def fetch() -> int:
    if not LIST.is_file():
        print(f"no {LIST.name}; run with --record on a machine that has the data", file=sys.stderr)
        return 1
    wanted = [l.strip() for l in LIST.read_text().splitlines() if l.strip() and not l.startswith("#")]
    sources = json.loads((GLOBAL / "sources.json").read_text())
    manifests = load_manifests()
    counts: dict[str, int] = {}
    failures: list[str] = []
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(fetch_one, rel, sources, manifests): rel for rel in wanted}
        for fut in cf.as_completed(futures):
            try:
                what = fut.result()
                counts[what] = counts.get(what, 0) + 1
            except Exception as e:  # noqa: BLE001
                failures.append(str(e))
    print(f"test data: {len(wanted)} files, {counts.get('fetched', 0)} fetched, "
          f"{counts.get('kept', 0)} already present and verified, {len(failures)} failed "
          f"({time.time() - t0:.0f} s)")
    for f in sorted(failures):
        print(f"  FAIL {f}")
    return 1 if failures else 0


def record() -> int:
    """Run the data tests under the fs hook and rewrite the list from what they read."""
    with tempfile.NamedTemporaryFile("r", suffix=".log", delete=False) as log:
        path = log.name
    try:
        for test in DATA_TESTS:
            r = subprocess.run(["node", "--import", str(HOOK), test], cwd=ROOT,
                               env={**os.environ, "FSLOG": path}, capture_output=True, text=True)
            if r.returncode:
                print(f"{test} fails even with the data present -- fix that first:\n{r.stdout[-800:]}",
                      file=sys.stderr)
                return 1
        seen = set()
        for line in pathlib.Path(path).read_text().splitlines():
            rel = line.split("data/global/", 1)[-1]
            if (GLOBAL / rel).is_file():
                seen.add(rel)
    finally:
        os.unlink(path)
    # The tracked metadata ships with the checkout; only what is published is listed.
    tracked = set(subprocess.run(["git", "ls-files", "data/global"], cwd=ROOT,
                                 capture_output=True, text=True).stdout.split())
    rels = sorted(r for r in seen if f"data/global/{r}" not in tracked)
    LIST.write_text("# Files under data/global the unit tests read. Written by\n"
                    "# fetch-test-data.py --record; fetched by it in CI.\n"
                    + "\n".join(rels) + "\n")
    print(f"recorded {len(rels)} files to {LIST.relative_to(ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--record", action="store_true", help="rebuild test-data.txt from what the tests read")
    args = ap.parse_args()
    return record() if args.record else fetch()


if __name__ == "__main__":
    sys.exit(main())
